import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "node:crypto";
import { PrismaClient, AccountType, EntryType, UserTier } from "./generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { resolveFlags } from "./lib/tier";
import { getChallengeDueWindow } from "./lib/challengeDue";
import { isFundingConfigured, getUsdcBalanceMicros } from "./lib/chainRead";
import { isCdpConfigured } from "./lib/cdpSessionToken";
import { createFundingSession } from "./lib/fundingProvider";
import { deterministicWalletProvider } from "./lib/walletProvider";
import { isAddress } from "viem";
import {
  sendMagicLinkEmail as sendMagicLinkEmailResend,
  sendWeeklyRecapEmail,
  type WeeklyRecapPayload,
} from "./email/resend";
import webpush from "web-push";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.string().optional().transform((s) => (s ? Number(s) : 4001)),
  // Auth (magic link + session)
  AUTH_PEPPER: z.string().min(1, "AUTH_PEPPER is required").optional(), // optional so dev can run without; auth routes will 503 if missing
  AUTH_TOKEN_TTL_MIN: z.string().optional().transform((s) => (s ? Number(s) : 15)),
  SESSION_TTL_DAYS: z.string().optional().transform((s) => (s ? Number(s) : 30)),
  SESSION_RENEW_WINDOW_DAYS: z.string().optional().transform((s) => (s ? Number(s) : 7)),
  APP_ORIGIN: z.string().url().optional().or(z.literal("")),
  API_ORIGIN: z.string().url().optional().or(z.literal("")),
  // Dev: allow X-User-Id header to stand in for session (no cookie needed)
  NODE_ENV: z.string().optional(),
  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  EMAIL_PROVIDER: z.string().optional(),
  // Web Push (VAPID)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  PUSH_ENABLED: z.string().optional().transform((s) => s === "true" || s === "1"),
  // Funding session (OnchainKit FundCard): provider + CDP
  FUNDING_PROVIDER: z.string().optional(),
  CDP_PROJECT_ID: z.string().optional(),
  CDP_API_KEY: z.string().optional(),
  FUNDING_SESSION_TTL_MIN: z.string().optional().transform((s) => (s ? Number(s) : 10)),
});
const env = EnvSchema.safeParse(process.env);
if (!env.success) {
  console.error("Env validation failed:", env.error.flatten());
  process.exit(1);
}
const isProd = (env.data.NODE_ENV || "").toLowerCase() === "production";
const emailProvider = (env.data.EMAIL_PROVIDER || "").toLowerCase();
if (isProd && emailProvider === "resend") {
  if (!env.data.RESEND_API_KEY?.trim() || !env.data.EMAIL_FROM?.trim()) {
    console.error(
      "In production with EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM are required",
    );
    process.exit(1);
  }
}

const VAPID_PUBLIC_KEY = env.data.VAPID_PUBLIC_KEY?.trim() ?? "";
const VAPID_PRIVATE_KEY = env.data.VAPID_PRIVATE_KEY?.trim() ?? "";
const PUSH_ENABLED = env.data.PUSH_ENABLED ?? false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    env.data.VAPID_SUBJECT ?? "mailto:push@stashjar.local",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

const adapter = new PrismaPg({
  connectionString: env.data.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });
const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.data.APP_ORIGIN ? [env.data.APP_ORIGIN] : true,
  credentials: true,
});

app.addHook("onRequest", async (request: any) => {
  request._startTime = Date.now();
});

app.addHook("onResponse", async (request: any, reply, payload) => {
  const start = request._startTime;
  if (typeof start === "number") {
    const durationMs = Date.now() - start;
    const userId = request.params?.userId ?? null;
    app.log.info({
      route: request.routerPath ?? request.url,
      method: request.method,
      userId: userId ?? undefined,
      durationMs,
      statusCode: reply.statusCode,
    });
  }
});

app.addHook("preHandler", async (request: any, reply) => {
  const ip = getClientIP(request);
  if (!checkRateLimit(ip, rateLimitIP, RATE_LIMIT_IP)) {
    return reply.code(429).header("Retry-After", "60").send({
      error: "rate_limit",
      retryAfterSeconds: 60,
    });
  }
});

const BUILD_TIMESTAMP = new Date().toISOString().slice(0, 19) + "Z";
const runDueLocks = new Map<string, Promise<any | null>>();
/** Single-flight per session id so parallel requests don't mint multiple sessions on renewal */
const renewLocks = new Map<string, Promise<string>>();

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as object).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as any)[k]));
  return "{" + pairs.join(",") + "}";
}

function sha1Hex(str: string): string {
  return crypto.createHash("sha1").update(str, "utf8").digest("hex");
}

function weakEtag(prefix: string, body: string): string {
  return `W/"${prefix}:${sha1Hex(body)}"`;
}

function ifNoneMatch(req: any): string | null {
  const v = req.headers["if-none-match"];
  return typeof v === "string" ? v.trim() : null;
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_IP = 60;
const RATE_LIMIT_USER_ACTIONS = 30;
const RATE_LIMIT_FUNDING_REFRESH = 10;
const RATE_LIMIT_FUNDING_SESSION = 3;
const rateLimitIP = new Map<string, { count: number; resetAt: number }>();
const rateLimitUser = new Map<string, { count: number; resetAt: number }>();
const rateLimitFundingRefresh = new Map<string, { count: number; resetAt: number }>();
const rateLimitFundingSession = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, map: Map<string, { count: number; resetAt: number }>, limit: number): boolean {
  const now = Date.now();
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (now >= cur.resetAt) {
    map.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}

function getClientIP(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
}

// --- Auth primitives (magic link + session) ---
const AUTH_TOKEN_TTL_MIN = env.data.AUTH_TOKEN_TTL_MIN ?? 15;
/** Per-email cooldown: at most one magic link per email per this many seconds */
const MAGIC_LINK_COOLDOWN_SEC = 30;
const SESSION_TTL_DAYS = env.data.SESSION_TTL_DAYS ?? 30;
const SESSION_RENEW_WINDOW_DAYS = env.data.SESSION_RENEW_WINDOW_DAYS ?? 7;
const AUTH_PEPPER = env.data.AUTH_PEPPER ?? "";
const APP_ORIGIN = (env.data.APP_ORIGIN || "").replace(/\/$/, "");
const API_ORIGIN = (env.data.API_ORIGIN || "").replace(/\/$/, "");
const IS_DEV = (env.data.NODE_ENV || "").toLowerCase() === "development";

function base64url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hashWithPepper(raw: string): string {
  if (!AUTH_PEPPER) return ""; // caller must check AUTH_PEPPER before using auth
  return crypto.createHash("sha256").update(raw + AUTH_PEPPER, "utf8").digest("hex");
}

function generateRawToken(): string {
  return base64url(crypto.randomBytes(32));
}

function generateRawSession(): string {
  return base64url(crypto.randomBytes(32));
}

const COOKIE_NAME = "stash_session";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

function setSessionCookie(reply: any, value: string, maxAgeDays: number): void {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeDays * 24 * 60 * 60}`,
  ];
  if (COOKIE_OPTS.secure) parts.push("Secure");
  reply.header("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(reply: any): void {
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

function getCookie(request: any, name: string): string | undefined {
  const raw = request.headers?.cookie;
  if (typeof raw !== "string") return undefined;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(raw);
  return match ? decodeURIComponent(match[1].trim()) : undefined;
}

async function requireAuth(request: any, reply: any): Promise<void> {
  const devUserId = IS_DEV && (request.headers["x-user-id"] as string)?.trim();
  if (devUserId) {
    const user = await prisma.user.findUnique({
      where: { id: devUserId },
      select: { id: true, email: true, tier: true, flags: true },
    });
    if (user) {
      request.user = { id: user.id, email: user.email ?? undefined, tier: user.tier, flags: user.flags };
      return;
    }
  }
  const rawSession = getCookie(request, COOKIE_NAME);
  if (!rawSession || typeof rawSession !== "string") {
    return reply.code(401).send({ error: "unauthorized", message: "No session" });
  }
  const sessionHash = hashWithPepper(rawSession);
  if (!sessionHash) {
    return reply.code(503).send({ error: "auth_not_configured", message: "AUTH_PEPPER not set" });
  }
  const session = await prisma.session.findFirst({
    where: { sessionHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, email: true, tier: true, flags: true } } },
  });
  if (!session) {
    return reply.code(401).send({ error: "unauthorized", message: "Invalid or expired session" });
  }
  request.user = {
    id: session.user.id,
    email: session.user.email ?? undefined,
    tier: session.user.tier,
    flags: session.user.flags,
  };

  // Sliding renewal: if session expires within the window, mint new session and set cookie (single-flight per session)
  const now = new Date();
  const renewIfExpiresBefore = new Date(
    Date.now() + SESSION_RENEW_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  if (session.expiresAt <= renewIfExpiresBefore) {
    let lock = renewLocks.get(session.id);
    if (!lock) {
      lock = (async (): Promise<string> => {
        try {
          const newRawSession = generateRawSession();
          const newSessionHash = hashWithPepper(newRawSession);
          const newExpiresAt = new Date(
            Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
          );
          await prisma.session.create({
            data: {
              userId: session.user.id,
              sessionHash: newSessionHash,
              expiresAt: newExpiresAt,
              ip: getClientIP(request),
              userAgent: (request.headers["user-agent"] as string) ?? undefined,
            },
          });
          await prisma.session.update({
            where: { id: session.id },
            data: { revokedAt: now },
          });
          return newRawSession;
        } finally {
          renewLocks.delete(session.id);
        }
      })();
      renewLocks.set(session.id, lock);
    }
    const newRawSession = await lock;
    setSessionCookie(reply, newRawSession, SESSION_TTL_DAYS);
    reply.header("X-Session-Renewed", "1");
  }
}

function assertUserIdParam(request: any, reply: any): boolean {
  const userId = (request.params as any)?.userId;
  if (!request.user || userId !== request.user.id) {
    reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
    return false;
  }
  return true;
}

async function requireUserIdMatch(request: any, reply: any): Promise<void> {
  if (!assertUserIdParam(request, reply)) return;
}

const todayCardsCache = new Map<
  string,
  { data: { cards: any[]; banner: any }; expiresAt: number }
>();
const TODAY_CARDS_CACHE_TTL_MS = 3000;

const weatherCache = new Map<
  string,
  { tempF: number; fetchedAtMs: number; provider: string }
>();
const weatherFetchCounts = new Map<string, { count: number; dayKey: string }>();

async function getSystemAccountId(type: AccountType) {
  const acc = await prisma.account.findFirst({
    where: { userId: null, type },
  });
  if (!acc) throw new Error(`Missing system account: ${type}`);
  return acc.id;
}

async function getUserStashAccountId(userId: string) {
  const acc = await prisma.account.findFirst({
    where: { userId, type: AccountType.USER_STASH },
  });
  if (!acc) throw new Error(`Missing USER_STASH for user: ${userId}`);
  return acc.id;
}

function dayOfWeekToNumber(dow: string): number {
  const v = dow.trim().toUpperCase();
  if (v === "SUN") return 0;
  if (v === "MON") return 1;
  if (v === "TUE") return 2;
  if (v === "WED") return 3;
  if (v === "THU") return 4;
  if (v === "FRI") return 5;
  if (v === "SAT") return 6;
  throw new Error(`Invalid dayOfWeek: ${dow}`);
}

function yyyymmddUtc(d: Date) {
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return iso.replaceAll("-", "");
}

function toDateStringUtc(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcDateOnly(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d: Date, n: number) {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function deterministicRoll(params: { userId: string; eventId: string; sides: number }): number {
  const salt = process.env.DICE_SALT ?? "dev_salt";
  const input = `${salt}:${params.userId}:${params.eventId}`;
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  const n = BigInt(`0x${hash}`);
  return Number(n % BigInt(params.sides)) + 1;
}

/** POWER dice: optional multi-dice (sum) or ×10 multiplier. Returns { roll, rollBreakdown? }. */
function resolveDiceRoll(params: {
  userId: string;
  eventId: string;
  sides: number;
  multiDice?: number;
}): { roll: number; rollBreakdown?: number[] } {
  const count = Math.max(1, Math.min(2, Number(params.multiDice ?? 1)));
  if (count === 1) {
    const roll = deterministicRoll({
      userId: params.userId,
      eventId: params.eventId,
      sides: params.sides,
    });
    return { roll };
  }
  const a = deterministicRoll({
    userId: params.userId,
    eventId: `${params.eventId}:d1`,
    sides: params.sides,
  });
  const b = deterministicRoll({
    userId: params.userId,
    eventId: `${params.eventId}:d2`,
    sides: params.sides,
  });
  return { roll: a + b, rollBreakdown: [a, b] };
}

function toTempF(value: number, unit: "F" | "C") {
  if (unit === "F") return value;
  return value * (9 / 5) + 32;
}

async function primeSingleChallengeDue(uc: any, now: Date) {
  const rules = (uc.rules as any) ?? {};
  const schedule = rules.schedule ?? {};
  const settings = (uc.settings as any) ?? {};
  const autoCommit = settings.autoCommit !== false;

  const dayKey = yyyymmddUtc(now);
  const eventIdempo = `sched_${uc.id}_${dayKey}`;

  const existing = await prisma.challengeEvent.findUnique({
    where: { idempotencyKey: eventIdempo },
  });
  if (existing) return { created: false, committed: false, eventId: existing.id };

  let amountCents: number | null = null;
  let metadata: any = {};

  if (rules.type === "weekly_increment") {
    const weekIndex =
      Math.floor((now.getTime() - uc.startDate.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
    amountCents =
      (rules.week1AmountCents ?? 100) + (weekIndex - 1) * (rules.incrementCents ?? 100);
    metadata = { weeksSinceStart: weekIndex };
  } else if (rules.type === "weather_wednesday" || rules.type === "temperature") {
    amountCents = autoCommit
      ? Number((rules.amount ?? {}).defaultAmountCents ?? 700) || 700
      : null;
    metadata = {
      weekday: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getUTCDay()],
      inputStatus: "NEEDS_INPUT",
    };
  } else if (rules.type === "dice") {
    metadata = {
      weekday: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getUTCDay()],
      rollStatus: "NEEDS_ROLL",
    };
    amountCents = null;
  } else {
    return { created: false, committed: false };
  }

  const created = await prisma.challengeEvent.create({
    data: {
      userChallengeId: uc.id,
      scheduledFor: now,
      idempotencyKey: eventIdempo,
      amountCents,
      result: "DEPOSIT_SCHEDULED",
      metadata: metadata as any,
    } as any,
  });

  if (autoCommit && amountCents && amountCents > 0) {
    const res = await commitChallengeEvent({
      userId: uc.userId,
      userChallengeId: uc.id,
      challengeEventId: created.id,
    });
    return { created: true, committed: res.status !== "ALREADY_COMMITTED", eventId: created.id };
  }

  return { created: true, committed: false, eventId: created.id };
}

function checkWeatherRateLimit(params: { userId: string; dateKey: string }) {
  const limit = Number(process.env.WEATHER_FETCH_DAILY_LIMIT ?? 10);
  const key = `${params.userId}:${params.dateKey}`;
  const existing = weatherFetchCounts.get(key);
  if (!existing) {
    weatherFetchCounts.set(key, { count: 1, dayKey: params.dateKey });
    return { ok: true, remaining: Math.max(0, limit - 1) };
  }
  if (existing.dayKey !== params.dateKey) {
    weatherFetchCounts.set(key, { count: 1, dayKey: params.dateKey });
    return { ok: true, remaining: Math.max(0, limit - 1) };
  }
  if (existing.count >= limit) {
    return { ok: false, remaining: 0 };
  }
  existing.count += 1;
  return { ok: true, remaining: Math.max(0, limit - existing.count) };
}

function getWeatherProvider() {
  return (process.env.WEATHER_PROVIDER ?? "openweather").toLowerCase();
}

function getWeatherApiKey() {
  return process.env.WEATHER_API_KEY ?? process.env.OPENWEATHER_API_KEY;
}

async function resolveOpenWeatherLatLon(params: {
  zip?: string;
  query?: string;
}): Promise<{ lat: number; lon: number }> {
  const apiKey = getWeatherApiKey();
  if (!apiKey) throw new Error("OPENWEATHER_API_KEY not set");

  if (params.zip) {
    const url = new URL("https://api.openweathermap.org/geo/1.0/zip");
    url.searchParams.set("zip", params.zip);
    url.searchParams.set("appid", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Failed to resolve zip");
    const data: any = await res.json();
    if (typeof data?.lat !== "number" || typeof data?.lon !== "number") {
      throw new Error("Invalid zip lookup result");
    }
    return { lat: data.lat, lon: data.lon };
  }

  if (params.query) {
    const url = new URL("https://api.openweathermap.org/geo/1.0/direct");
    url.searchParams.set("q", params.query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("appid", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Failed to resolve place");
    const data: any = await res.json();
    const first = Array.isArray(data) ? data[0] : null;
    if (!first || typeof first.lat !== "number" || typeof first.lon !== "number") {
      throw new Error("Invalid place lookup result");
    }
    return { lat: first.lat, lon: first.lon };
  }

  throw new Error("Missing zip or query");
}

async function fetchTempF_OpenWeather(params: {
  lat: number;
  lon: number;
}): Promise<{ tempF: number; provider: string }> {
  const apiKey = getWeatherApiKey();
  if (!apiKey) throw new Error("OPENWEATHER_API_KEY not set");

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", params.lat.toString());
  url.searchParams.set("lon", params.lon.toString());
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "imperial");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch weather");
  const data: any = await res.json();
  const temp = data?.main?.temp;
  if (typeof temp !== "number") throw new Error("Invalid weather response");
  return { tempF: temp, provider: "openweather" };
}

async function getTemperatureForDate(params: {
  dateKey: string;
  lat: number;
  lon: number;
}): Promise<{ tempF: number; provider: string }> {
  const provider = getWeatherProvider();
  if (provider !== "openweather") {
    throw new Error(`Unsupported weather provider: ${provider}`);
  }

  const lat = Math.round(params.lat * 100) / 100;
  const lon = Math.round(params.lon * 100) / 100;
  const cacheKey = `wx:${params.dateKey}:F:${lat}:${lon}`;
  const cached = weatherCache.get(cacheKey);
  const ttlMs = Number(process.env.WEATHER_CACHE_TTL_MS ?? 2 * 60 * 60 * 1000);
  if (cached && Date.now() - cached.fetchedAtMs < ttlMs) {
    return { tempF: cached.tempF, provider: cached.provider };
  }

  const fresh = await fetchTempF_OpenWeather({ lat, lon });
  weatherCache.set(cacheKey, {
    tempF: fresh.tempF,
    fetchedAtMs: Date.now(),
    provider: fresh.provider,
  });
  return fresh;
}

async function commitChallengeEvent(params: {
  userId: string;
  userChallengeId: string;
  challengeEventId: string;
}) {
  const { userId, userChallengeId, challengeEventId } = params;
  const idempo = `challenge_dep_${challengeEventId}`;

  const ce = await prisma.challengeEvent.findUnique({
    where: { id: challengeEventId },
    include: { userChallenge: true },
  });
  if (!ce) throw new Error("Challenge event not found");
  if (ce.userChallengeId !== userChallengeId) throw new Error("Challenge mismatch");
  if (ce.userChallenge?.userId !== userId) throw new Error("User mismatch");

  if (ce.paymentIntentId) {
    return { paymentIntentId: ce.paymentIntentId, status: "ALREADY_COMMITTED" };
  }

    const amountCents = ce.amountCents;
    if (!amountCents || amountCents <= 0) throw new Error("Invalid amount");

  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);
  const externalClearingId = await getSystemAccountId(AccountType.EXTERNAL_CLEARING);
  const userStashId = await getUserStashAccountId(userId);

  const pi = await prisma.$transaction(async (tx) => {
    let existing = await tx.paymentIntent.findUnique({ where: { idempotencyKey: idempo } });
    let didSettle = false;

    if (!existing) {
      const jeInit = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}_init`,
          type: EntryType.DEPOSIT_INITIATED,
          metadata: { source: "challenge", challengeEventId, userChallengeId, amountCents },
          lines: {
            create: [
              { accountId: pendingDepositId, amountCents, memo: "Challenge deposit initiated" },
              { accountId: externalClearingId, amountCents: -amountCents, memo: "Awaiting funds" },
            ],
          },
        },
      });

      existing = await tx.paymentIntent.create({
        data: {
          userId,
          type: "DEPOSIT",
          status: "PROCESSING",
          amountCents,
          idempotencyKey: idempo,
          initiatedEntryId: jeInit.id,
          metadata: { source: "challenge", challengeEventId, userChallengeId },
        },
      });
    }

    if (existing.status !== "SETTLED") {
      const jeSettle = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}_settle`,
          type: EntryType.DEPOSIT_SETTLED,
          metadata: { source: "challenge", challengeEventId, userChallengeId },
          lines: {
            create: [
              { accountId: userStashId, amountCents, memo: "Challenge deposit settled" },
              { accountId: pendingDepositId, amountCents: -amountCents, memo: "Release pending deposit" },
            ],
          },
        },
      });

      existing = await tx.paymentIntent.update({
        where: { id: existing.id },
        data: { status: "SETTLED", settledEntryId: jeSettle.id },
      });
      didSettle = true;
    }

    await tx.challengeEvent.update({
      where: { id: ce.id },
      data: {
        paymentIntentId: existing.id,
        metadata: { ...(ce.metadata as any), committedAt: new Date().toISOString() },
      },
    });

    // Streak: first challenge save this UTC day extends or starts streak; POWER shield recovery consumes on 2 saves
    if (didSettle) {
      const now = new Date();
      const dayStart = utcDateOnly(now);
      const dayEnd = addDaysUtc(dayStart, 1);
      const todayStr = toDateStringUtc(now);
      const yesterdayStr = toDateStringUtc(addDaysUtc(dayStart, -1));
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          tier: true,
          lastStreakDateUtc: true,
          currentStreakDays: true,
          bestStreakDays: true,
          streakShieldAvailable: true,
          streakShieldUsedAtUtc: true,
        },
      });
      if (user) {
        const u = user as any;
        const tier = u.tier ?? "NORMIE";
        const last = u.lastStreakDateUtc ?? null;
        const current = typeof u.currentStreakDays === "number" ? u.currentStreakDays : 0;
        const best = typeof u.bestStreakDays === "number" ? u.bestStreakDays : 0;
        const shieldUsedAt = u.streakShieldUsedAtUtc ?? null;
        const isPower = tier === "POWER" || tier === "DEV";
        let clearShield = false;
        if (isPower && shieldUsedAt) {
          const recoveryDay = toDateStringUtc(addDaysUtc(new Date(shieldUsedAt + "T12:00:00.000Z"), 1));
          if (todayStr === recoveryDay) {
            const todaySaves = await tx.paymentIntent.count({
              where: {
                userId,
                type: "DEPOSIT",
                status: "SETTLED",
                createdAt: { gte: dayStart, lt: dayEnd },
                metadata: { path: ["source"], equals: "challenge" },
              },
            });
            if (todaySaves >= 2) clearShield = true;
          }
        }
        let newCurrent: number;
        if (last === todayStr) newCurrent = current;
        else if (last === yesterdayStr) newCurrent = current + 1;
        else newCurrent = 1;
        const newBest = Math.max(best, newCurrent);
        await tx.user.update({
          where: { id: userId },
          data: {
            lastStreakDateUtc: todayStr,
            currentStreakDays: newCurrent,
            bestStreakDays: newBest,
            ...(clearShield ? { streakShieldAvailable: false, streakShieldUsedAtUtc: null } : {}),
          } as any,
        });
      }
    }

    return existing;
  });

  return { paymentIntentId: pi.id, status: pi.status };
}

async function createDepositIntentAndLedger(params: {
  userId: string;
  amountCents: number;
  idempotencyKey: string; // payment intent idempo
  metadata?: any;
}) {
  const { userId, amountCents, idempotencyKey, metadata } = params;

  const existing = await prisma.paymentIntent.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);
  const externalClearingId = await getSystemAccountId(
    AccountType.EXTERNAL_CLEARING,
  );

  return prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        idempotencyKey: `je_${idempotencyKey}_initiated`,
        type: EntryType.DEPOSIT_INITIATED,
        metadata: { userId, amountCents, ...metadata },
        lines: {
          create: [
            {
              accountId: pendingDepositId,
              amountCents,
              memo: "Deposit initiated",
            },
            {
              accountId: externalClearingId,
              amountCents: -amountCents,
              memo: "Awaiting funds",
            },
          ],
        },
      },
    });

    const pi = await tx.paymentIntent.create({
      data: {
        userId,
        type: "DEPOSIT",
        status: "PROCESSING",
        amountCents,
        idempotencyKey,
        initiatedEntryId: je.id,
        metadata,
      },
    });

    return pi;
  });
}

const PostEntrySchema = z.object({
  idempotencyKey: z.string().min(8),
  type: z.enum([
    "DEPOSIT_INITIATED",
    "DEPOSIT_SETTLED",
    "WITHDRAW_REQUESTED",
    "WITHDRAW_PAID",
    "YIELD_ACCRUED",
    "FEE_CHARGED",
    "REVERSAL",
  ]),
  occurredAt: z.string().datetime().optional(),
  metadata: z.any().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        amountCents: z
          .number()
          .int()
          .refine((v) => v !== 0, {
            message: "amountCents must be non-zero",
          }),
        memo: z.string().optional(),
      }),
    )
    .min(2),
});

app.get("/health", async () => ({ ok: true }));

// Create a user + their stash account + system accounts (if missing)
app.post("/users", async () => {
  const user = await prisma.user.create({ data: {} });

  // user stash
  await prisma.account.create({
    data: { userId: user.id, type: AccountType.USER_STASH },
  });

  // create required system accounts if not exist
  const systemTypes: AccountType[] = [
    AccountType.PENDING_DEPOSIT,
    AccountType.PENDING_WITHDRAW,
    AccountType.EXTERNAL_CLEARING,
    AccountType.TREASURY_USDC,
    AccountType.FEES_REVENUE,
  ];

  for (const t of systemTypes) {
    const exists = await prisma.account.findFirst({
      where: { userId: null, type: t },
    });
    if (!exists) {
      await prisma.account.create({ data: { userId: null, type: t } });
    }
  }

  return { userId: user.id };
});

async function ensureUserForEmail(email: string): Promise<{ userId: string }> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { userId: existing.id };
  const user = await prisma.user.create({ data: { email } });
  await prisma.account.create({
    data: { userId: user.id, type: AccountType.USER_STASH },
  });
  const systemTypes: AccountType[] = [
    AccountType.PENDING_DEPOSIT,
    AccountType.PENDING_WITHDRAW,
    AccountType.EXTERNAL_CLEARING,
    AccountType.TREASURY_USDC,
    AccountType.FEES_REVENUE,
  ];
  for (const t of systemTypes) {
    const exists = await prisma.account.findFirst({
      where: { userId: null, type: t },
    });
    if (!exists) {
      await prisma.account.create({ data: { userId: null, type: t } });
    }
  }
  return { userId: user.id };
}

// Post a journal entry (idempotent, atomic, must sum to 0)
app.post("/ledger/entries", async (req, reply) => {
  const parsed = PostEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const data = parsed.data;
  const net = data.lines.reduce((s, l) => s + l.amountCents, 0);
  if (net !== 0) {
    return reply
      .code(400)
      .send({ error: "Journal entry lines must sum to 0.", net });
  }

  // idempotency: if exists, return existing
  const existing = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
    include: { lines: true },
  });
  if (existing) return existing;

  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      // create entry + lines atomically
      const entry = await tx.journalEntry.create({
        data: {
          idempotencyKey: data.idempotencyKey,
            type: data.type as EntryType,
          occurredAt,
            metadata: data.metadata ?? undefined,
          lines: {
            create: data.lines.map((l) => ({
              accountId: l.accountId,
              amountCents: l.amountCents,
              memo: l.memo,
            })),
          },
        },
        include: { lines: true },
      });
      return entry;
    });

    return created;
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message, stack: err.stack });
  }
});

// Get account balance
app.get("/ledger/accounts/:accountId/balance", async (req, reply) => {
  const accountId = (req.params as any).accountId as string;

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return reply.code(404).send({ error: "Account not found" });

  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { amountCents: true },
  });

  return {
    accountId,
    type: account.type,
    currency: account.currency,
    balanceCents: agg._sum.amountCents ?? 0,
  };
});

// --- Auth routes (magic link + session) ---
function sanitizeReturnTo(value: string | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.includes("//")) return null;
  return trimmed;
}

const AuthStartSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  returnTo: z.string().optional(),
});

app.post("/auth/start", async (req, reply) => {
  const ip = getClientIP(req);
  if (!checkRateLimit(`auth:ip:${ip}`, rateLimitIP, 10)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }
  const parsed = AuthStartSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const email = parsed.data.email;
  const returnTo = sanitizeReturnTo(parsed.data.returnTo) ?? null;
  if (!checkRateLimit(`auth:email:${email}`, rateLimitUser, 5)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }
  if (!AUTH_PEPPER) {
    app.log.info({ email }, "auth/start: AUTH_PEPPER not set, skipping magic link");
    return reply.send({ ok: true });
  }
  const cooldownCutoff = new Date(Date.now() - MAGIC_LINK_COOLDOWN_SEC * 1000);
  const recent = await prisma.authToken.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent && recent.createdAt > cooldownCutoff) {
    const emailDomain = email.includes("@") ? email.split("@")[1] : "";
    app.log.info({ reason: "cooldown", emailDomain }, "auth/start: per-email cooldown");
    return reply.send({ ok: true });
  }
  const rawToken = generateRawToken();
  const tokenHash = hashWithPepper(rawToken);
  const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MIN * 60 * 1000);
  await prisma.authToken.create({
    data: {
      email,
      tokenHash,
      purpose: "magic_link",
      returnTo,
      expiresAt,
      ip: getClientIP(req),
      userAgent: (req.headers["user-agent"] as string) ?? undefined,
    },
  });
  const baseUrl = API_ORIGIN || `http://localhost:${env.data.PORT}`;
  const callbackUrl = `${baseUrl}/auth/callback?token=${encodeURIComponent(rawToken)}`;
  const useResend =
    (process.env.EMAIL_PROVIDER || "").toLowerCase() === "resend" &&
    process.env.RESEND_API_KEY?.trim() &&
    process.env.EMAIL_FROM?.trim();
  if (IS_DEV) {
    app.log.info({ email, link: callbackUrl }, "magic link (dev)");
  }
  if (useResend) {
    const result = await sendMagicLinkEmailResend(email, callbackUrl);
    if (!result.ok) {
      const requestId = (req as any).id ?? crypto.randomBytes(4).toString("hex");
      const emailDomain = email.includes("@") ? email.split("@")[1] : "";
      app.log.error(
        { requestId, emailDomain, error: result.error },
        "auth/start: magic link email send failed",
      );
    }
  }
  return reply.send({ ok: true });
});

app.get("/auth/callback", async (req, reply) => {
  const token = (req.query as any)?.token as string;
  if (!token || typeof token !== "string") {
    return reply.redirect(302, APP_ORIGIN ? `${APP_ORIGIN}/auth/error?reason=missing_token` : "/");
  }
  if (!AUTH_PEPPER) {
    return reply.redirect(302, APP_ORIGIN ? `${APP_ORIGIN}/auth/error?reason=config` : "/");
  }
  const tokenHash = hashWithPepper(token);
  const row = await prisma.authToken.findFirst({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!row) {
    return reply.redirect(302, APP_ORIGIN ? `${APP_ORIGIN}/auth/error?reason=invalid` : "/");
  }
  await prisma.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  const returnToPath = sanitizeReturnTo(row.returnTo) ?? "/";
  let user = await prisma.user.findUnique({ where: { email: row.email } });
  if (!user) {
    const created = await ensureUserForEmail(row.email);
    user = await prisma.user.findUnique({ where: { id: created.userId } })!;
  } else if (!user.email) {
    await prisma.user.update({ where: { id: user.id }, data: { email: row.email } });
    user = await prisma.user.findUnique({ where: { id: user.id } })!;
  }
  const rawSession = generateRawSession();
  const sessionHash = hashWithPepper(rawSession);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId: user!.id,
      sessionHash,
      expiresAt,
      ip: getClientIP(req),
      userAgent: (req.headers["user-agent"] as string) ?? undefined,
    },
  });
  const successPath = `/auth/success?returnTo=${encodeURIComponent(returnToPath)}`;
  const redirectTo = APP_ORIGIN ? `${APP_ORIGIN}${successPath}` : successPath;
  setSessionCookie(reply, rawSession, SESSION_TTL_DAYS);
  return reply.redirect(302, redirectTo);
});

app.post("/auth/logout", async (req, reply) => {
  const rawSession = getCookie(req, COOKIE_NAME);
  if (rawSession && AUTH_PEPPER) {
    const sessionHash = hashWithPepper(rawSession);
    await prisma.session.updateMany({
      where: { sessionHash },
      data: { revokedAt: new Date() },
    });
  }
  clearSessionCookie(reply);
  return reply.send({ ok: true });
});

const MIN_DEPOSIT_CENTS = 100;
const MAX_DEPOSIT_CENTS = 500_000; // $5k

function buildWalletAndFunding(
  user: {
    wallet?: {
      address: string;
      walletType: string;
      chain: string;
      lastFundingRefreshAt?: Date | null;
      lastObservedBalanceMicros?: string | null;
    } | null;
  },
  flags: Record<string, boolean>,
) {
  const uw = user.wallet;
  const ready = !!uw?.address;
  const fundingConfigured = isFundingConfigured();
  const showAddress = flags.showVaultShares || flags.showCryptoLabels;

  const wallet = {
    ready,
    provisioning: false,
    type: (uw?.walletType ?? "SMART") as "SMART" | "EXTERNAL",
    chain: (uw?.chain ?? "base") as string,
    address: showAddress || ready ? (uw?.address ?? null) : null,
  };

  const funding = fundingConfigured && ready
    ? {
        enabled: true,
        provider: "coinbase" as const,
        rail: "USDC",
        limits: { minDepositCents: MIN_DEPOSIT_CENTS, maxDepositCents: MAX_DEPOSIT_CENTS },
        lastRefreshAt: uw?.lastFundingRefreshAt?.toISOString() ?? null,
        lastObservedBalanceMicros: uw?.lastObservedBalanceMicros ?? null,
        ui: { primaryCtaLabel: "Add money", secondaryCtaLabel: "Withdraw" },
      }
    : {
        enabled: false,
        provider: null as string | null,
        rail: "USDC",
        reason: (!fundingConfigured ? "not_configured" : "wallet_not_ready") as "not_configured" | "wallet_not_ready",
      };

  return { wallet, funding };
}

app.get("/auth/me", async (req, reply) => {
  const devUserId = IS_DEV && (req.headers["x-user-id"] as string)?.trim();
  if (devUserId) {
    const user = await prisma.user.findUnique({
      where: { id: devUserId },
      select: { id: true, email: true, tier: true, flags: true, wallet: true },
    });
    if (user) {
      const flags = resolveFlags(user.tier as any, user.flags);
      const { wallet, funding } = buildWalletAndFunding(user, flags);
      return reply.send({
        userId: user.id,
        email: user.email ?? undefined,
        tier: user.tier,
        flags,
        wallet,
        funding,
      });
    }
  }
  const rawSession = getCookie(req, COOKIE_NAME);
  if (!rawSession) return reply.code(401).send({ error: "unauthorized" });
  const sessionHash = hashWithPepper(rawSession);
  if (!sessionHash) return reply.code(503).send({ error: "auth_not_configured" });
  const session = await prisma.session.findFirst({
    where: { sessionHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, email: true, tier: true, flags: true, wallet: true } } },
  });
  if (!session) return reply.code(401).send({ error: "unauthorized" });
  const flags = resolveFlags(session.user.tier as any, session.user.flags);
  const { wallet, funding } = buildWalletAndFunding(session.user, flags);
  return reply.send({
    userId: session.user.id,
    email: session.user.email ?? undefined,
    tier: session.user.tier,
    flags,
    wallet,
    funding,
  });
});

// --- Push subscriptions (auth required; userId from session) ---
const PushSubscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
app.post("/push/subscribe", { preHandler: [requireAuth] }, async (req, reply) => {
  const user = (req as any).user;
  if (!user?.id) return reply.code(401).send({ error: "unauthorized" });
  const parsed = PushSubscribeSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { endpoint, keys } = parsed.data;
  const userAgent = (req.headers["user-agent"] as string) ?? undefined;
  const now = new Date();
  await prisma.pushSubscription.upsert({
    where: {
      userId_endpoint: { userId: user.id, endpoint },
    },
    create: {
      userId: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      lastUsedAt: now,
      userAgent,
    },
    update: {
      p256dh: keys.p256dh,
      auth: keys.auth,
      lastUsedAt: now,
      revokedAt: null,
      userAgent,
    },
  });
  return reply.send({ ok: true });
});

const PushUnsubscribeSchema = z.object({ endpoint: z.string().min(1) });
app.post("/push/unsubscribe", { preHandler: [requireAuth] }, async (req, reply) => {
  const user = (req as any).user;
  if (!user?.id) return reply.code(401).send({ error: "unauthorized" });
  const parsed = PushUnsubscribeSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const now = new Date();
  await prisma.pushSubscription.updateMany({
    where: { userId: user.id, endpoint: parsed.data.endpoint },
    data: { revokedAt: now },
  });
  return reply.send({ ok: true });
});

app.get("/push/status", { preHandler: [requireAuth] }, async (req, reply) => {
  const user = (req as any).user;
  if (!user?.id) return reply.code(401).send({ error: "unauthorized" });
  const subscriptionCount = await prisma.pushSubscription.count({
    where: { userId: user.id, revokedAt: null },
  });
  return reply.send({
    enabled: PUSH_ENABLED && !!VAPID_PUBLIC_KEY,
    subscriptionCount,
  });
});

app.get("/push/vapid-public", async (_req, reply) => {
  if (!VAPID_PUBLIC_KEY) return reply.code(503).send({ error: "push_not_configured" });
  return reply.send({ vapidPublicKey: VAPID_PUBLIC_KEY });
});

app.post("/push/test", { preHandler: [requireAuth] }, async (req, reply) => {
  if (!IS_DEV) return reply.code(403).send({ error: "test_push_only_in_dev" });
  const user = (req as any).user;
  if (!user?.id) return reply.code(401).send({ error: "unauthorized" });
  if (!PUSH_ENABLED || !VAPID_PRIVATE_KEY) {
    return reply.code(503).send({ error: "push_not_configured" });
  }
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: user.id, revokedAt: null },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  const payload = { title: "My Stash Jar", body: "Push works ✅", deeplink: "/" };
  let sent = 0;
  const now = new Date();
  for (const sub of subs) {
    const result = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
    );
    if (result.ok) sent++;
    else if (result.statusCode === 410 || result.statusCode === 404) {
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { revokedAt: now },
      });
      app.log.info({ subscriptionId: sub.id, statusCode: result.statusCode }, "push/test: subscription revoked (gone)");
    }
  }
  app.log.info({ userId: user.id, subscriptionCount: subs.length, sent }, "push/test: sent test notification");
  return reply.send({ ok: true, sent, subscriptionCount: subs.length });
});

// Utility: list a user's accounts
app.get("/users/:userId/accounts", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { accounts: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const systemAccounts = await prisma.account.findMany({
    where: { userId: null },
  });

  return { userId, userAccounts: user.accounts, systemAccounts };
});

const CreateDepositSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.number().int().positive().max(500_000), // $5,000 cap for now
  idempotencyKey: z.string().min(8),
});

app.post("/payments/deposits", async (req, reply) => {
  const parsed = CreateDepositSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, amountCents, idempotencyKey } = parsed.data;

  try {
    const pi = await createDepositIntentAndLedger({
      userId,
      amountCents,
      idempotencyKey,
    });

    const userStashId = await getUserStashAccountId(userId);

    return {
      paymentIntent: pi,
      initiatedEntryId: pi.initiatedEntryId,
      userStashAccountId: userStashId,
    };
  } catch (err: any) {
    return reply.code(500).send({ error: err.message });
  }
});

const SettleDepositSchema = z.object({
  paymentIntentId: z.string().uuid(),
  provider: z.string().optional(),
  providerRef: z.string().optional(),
});

app.post("/webhooks/deposits/settled", async (req, reply) => {
  const parsed = SettleDepositSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { paymentIntentId, provider, providerRef } = parsed.data;

  const pi = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });
  if (!pi) return reply.code(404).send({ error: "PaymentIntent not found" });

  if (pi.status === "SETTLED") return pi;

  const userStashId = await getUserStashAccountId(pi.userId);
  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);

  const idempo = `settle_${pi.id}`;

  const result = await prisma.$transaction(async (tx) => {
    // Create ledger entry: DEPOSIT_SETTLED
    const existingJE = await tx.journalEntry.findUnique({
      where: { idempotencyKey: `je_${idempo}` },
    });
    let jeId = existingJE?.id;

    if (!existingJE) {
      const je = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}`,
              type: EntryType.DEPOSIT_SETTLED,
              metadata: { paymentIntentId: pi.id, provider, providerRef },
          lines: {
            create: [
              {
                accountId: userStashId,
                amountCents: pi.amountCents,
                memo: "Deposit settled",
              },
              {
                accountId: pendingDepositId,
                amountCents: -pi.amountCents,
                memo: "Release pending",
              },
            ],
          },
        },
      });
      jeId = je.id;
    }

    const updated = await tx.paymentIntent.update({
      where: { id: pi.id },
      data: {
        status: "SETTLED",
        provider: provider ?? pi.provider,
        providerRef: providerRef ?? pi.providerRef,
        settledEntryId: jeId,
      },
    });

    return updated;
  });

  return result;
});

const WithdrawRequestSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().min(8),
});

const WithdrawWalletSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.number().int().min(100, "Minimum $1.00"),
  recipient: z.string().refine((val) => isAddress(val), {
    message: "Invalid EVM address",
  }),
  idempotencyKey: z.string().min(8),
});

app.post("/payments/withdrawals", async (req, reply) => {
  const parsed = WithdrawRequestSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, amountCents, idempotencyKey } = parsed.data;

  const existing = await prisma.paymentIntent.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const userStashId = await getUserStashAccountId(userId);
  const pendingWithdrawId = await getSystemAccountId(
    AccountType.PENDING_WITHDRAW,
  );

  // Ensure user has balance
  const agg = await prisma.journalLine.aggregate({
    where: { accountId: userStashId },
    _sum: { amountCents: true },
  });
  const bal = agg._sum.amountCents ?? 0;
  if (bal < amountCents)
    return reply
      .code(400)
      .send({ error: "Insufficient balance", balanceCents: bal });

  const created = await prisma.$transaction(async (tx) => {
    // WITHDRAW_REQUESTED: DR Pending Withdraw +amount, CR User Stash -amount
    const je = await tx.journalEntry.create({
      data: {
        idempotencyKey: `je_${idempotencyKey}_withdrawal`,
        type: EntryType.WITHDRAW_REQUESTED,
        metadata: { userId, amountCents },
        lines: {
          create: [
            {
              accountId: pendingWithdrawId,
              amountCents: amountCents,
              memo: "Withdraw requested",
            },
            {
              accountId: userStashId,
              amountCents: -amountCents,
              memo: "Reserve funds",
            },
          ],
        },
      },
    });

    const pi = await tx.paymentIntent.create({
      data: {
        userId,
        type: "WITHDRAW",
        status: "PROCESSING",
        amountCents,
        idempotencyKey,
        initiatedEntryId: je.id,
      },
    });

    return pi;
  });

  return created;
});

app.post("/users/:userId/withdraw/wallet", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const pathUserId = (req.params as any).userId as string;
  const parsed = WithdrawWalletSchema.safeParse({ ...req.body, userId: pathUserId });
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, amountCents, recipient, idempotencyKey } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const flags = resolveFlags(user.tier as any, user.flags);
  if (!flags.enableOnchainWithdrawToWallet) {
    return reply.code(403).send({ error: "Onchain withdraw not enabled for user" });
  }

  // Rate limits
  const now = new Date();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cooldownAgo = new Date(Date.now() - 30 * 1000);

  const recent = await prisma.paymentIntent.findMany({
    where: {
      userId,
      type: "WITHDRAW",
      createdAt: { gte: dayAgo },
      metadata: { path: ["rail"], equals: "ONCHAIN" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recent[0] && recent[0].createdAt >= cooldownAgo) {
    return reply.code(429).send({ error: "cooldown", retryAfterSeconds: 30 });
  }

  if (recent.length >= 3) {
    return reply.code(429).send({ error: "daily_limit_count", limit: 3 });
  }

  const used = recent.reduce((s, r) => s + r.amountCents, 0);
  if (used + amountCents > 50_000) {
    return reply
      .code(429)
      .send({ error: "daily_limit_amount", limitCents: 50_000, usedCents: used });
  }

  const existing = await prisma.paymentIntent.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  const userStashId = await getUserStashAccountId(userId);
  const pendingWithdrawId = await getSystemAccountId(AccountType.PENDING_WITHDRAW);

  const agg = await prisma.journalLine.aggregate({
    where: { accountId: userStashId },
    _sum: { amountCents: true },
  });
  const bal = agg._sum.amountCents ?? 0;
  if (bal < amountCents)
    return reply.code(400).send({ error: "Insufficient balance", balanceCents: bal });

  const created = await prisma.$transaction(async (tx) => {
    const je = await tx.journalEntry.create({
      data: {
        idempotencyKey: `je_${idempotencyKey}_withdraw_wallet`,
        type: EntryType.WITHDRAW_REQUESTED,
        metadata: { userId, amountCents, rail: "ONCHAIN", recipient },
        lines: {
          create: [
            { accountId: pendingWithdrawId, amountCents, memo: "Withdraw to wallet requested" },
            { accountId: userStashId, amountCents: -amountCents, memo: "Reserve funds" },
          ],
        },
      },
    });

    const pi = await tx.paymentIntent.create({
      data: {
        userId,
        type: "WITHDRAW",
        status: "PROCESSING",
        amountCents,
        idempotencyKey,
        initiatedEntryId: je.id,
        metadata: { rail: "ONCHAIN", recipient },
      },
    });

    return pi;
  });

  return created;
});

const WithdrawPaidSchema = z.object({
  paymentIntentId: z.string().uuid(),
  provider: z.string().optional(),
  providerRef: z.string().optional(),
});

app.post("/webhooks/withdrawals/paid", async (req, reply) => {
  const parsed = WithdrawPaidSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { paymentIntentId, provider, providerRef } = parsed.data;

  const pi = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId },
  });
  if (!pi) return reply.code(404).send({ error: "PaymentIntent not found" });
  if (pi.status === "SETTLED") return pi; // treat paid as settled for withdrawals

  const pendingWithdrawId = await getSystemAccountId(
    AccountType.PENDING_WITHDRAW,
  );
  const externalClearingId = await getSystemAccountId(
    AccountType.EXTERNAL_CLEARING,
  );

  const idempo = `withdraw_paid_${pi.id}`;

  const updated = await prisma.$transaction(async (tx) => {
    const existingJE = await tx.journalEntry.findUnique({
      where: { idempotencyKey: `je_${idempo}` },
    });
    let jeId = existingJE?.id;

    if (!existingJE) {
      const je = await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}`,
          type: EntryType.WITHDRAW_PAID,
          metadata: { paymentIntentId: pi.id, provider, providerRef },
          lines: {
            create: [
              {
                accountId: externalClearingId,
                amountCents: pi.amountCents,
                memo: "Payout sent",
              },
              {
                accountId: pendingWithdrawId,
                amountCents: -pi.amountCents,
                memo: "Clear pending withdrawal",
              },
            ],
          },
        },
      });
      jeId = je.id;
    }

    return tx.paymentIntent.update({
      where: { id: pi.id },
      data: {
        status: "SETTLED",
        provider: provider ?? pi.provider,
        providerRef: providerRef ?? pi.providerRef,
        settledEntryId: jeId,
      },
    });
  });

  return updated;
});

app.get("/users/:userId/transactions", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const stashId = await getUserStashAccountId(userId);

  const lines = await prisma.journalLine.findMany({
    where: { accountId: stashId },
    include: { entry: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const txs = lines.map((l) => ({
    occurredAt: l.entry.occurredAt,
    type: l.entry.type,
    amountCents: l.amountCents,
    memo: l.memo ?? null,
    entryId: l.entryId,
    metadata: (l.entry as any).metadata ?? null,
  }));

  return { userId, transactions: txs };
});

// --- Treasury funding (dev/admin) ---
const FundTreasurySchema = z.object({
  amountCents: z.number().int().positive(),
  idempotencyKey: z.string().min(8),
});

app.post("/admin/treasury/fund", async (req, reply) => {
  const parsed = FundTreasurySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const { amountCents, idempotencyKey } = parsed.data;
  const treasuryId = await getSystemAccountId(AccountType.TREASURY_USDC);
  const externalClearingId = await getSystemAccountId(AccountType.EXTERNAL_CLEARING);

  const existingJE = await prisma.journalEntry.findUnique({ where: { idempotencyKey } });
  if (existingJE) return existingJE;

  const created = await prisma.journalEntry.create({
    data: {
      idempotencyKey,
      type: EntryType.TREASURY_FUNDED,
      metadata: { note: "Treasury funded (dev)" },
      lines: {
        create: [
          { accountId: treasuryId, amountCents, memo: "Treasury funded" },
          { accountId: externalClearingId, amountCents: -amountCents, memo: "External source" },
        ],
      },
    },
  });

  return created;
});

// --- Yield accrual (dev/admin) ---
const YieldAccrueSchema = z.object({
  runKey: z.string().min(6),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  totalYieldCents: z.number().int().positive(),
});

app.post("/admin/yield/accrue", async (req, reply) => {
  const parsed = YieldAccrueSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const { runKey, periodStart, periodEnd, totalYieldCents } = parsed.data;

  const existingRun = await prisma.yieldRun.findUnique({ where: { runKey } });
  if (existingRun && existingRun.status === "POSTED") return existingRun;

  const treasuryId = await getSystemAccountId(AccountType.TREASURY_USDC);
  const treBalAgg = await prisma.journalLine.aggregate({
    where: { accountId: treasuryId },
    _sum: { amountCents: true },
  });
  const treasuryBal = treBalAgg._sum.amountCents ?? 0;
  if (treasuryBal < totalYieldCents) {
    return reply.code(400).send({
      error: "Treasury balance insufficient to distribute yield",
      treasuryBal,
      required: totalYieldCents,
    });
  }

  const run =
    existingRun ??
    (await prisma.yieldRun.create({
      data: {
        runKey,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        totalYieldCents,
        status: "CREATED",
      },
    }));

  const users = await prisma.user.findMany({ include: { accounts: true } });

  const balances: { userId: string; stashId: string; bal: number }[] = [];
  for (const u of users) {
    const stash = u.accounts.find((a) => a.type === AccountType.USER_STASH);
    if (!stash) continue;
    const agg = await prisma.journalLine.aggregate({
      where: { accountId: stash.id },
      _sum: { amountCents: true },
    });
    const bal = agg._sum.amountCents ?? 0;
    if (bal > 0) balances.push({ userId: u.id, stashId: stash.id, bal });
  }

  const sumWeights = balances.reduce((s, b) => s + b.bal, 0);
  if (sumWeights <= 0) {
    return reply.code(400).send({ error: "No positive balances found to allocate yield" });
  }

  let allocated = 0;
  const allocs = balances.map((b) => {
    const raw = (totalYieldCents * b.bal) / sumWeights;
    const amt = Math.floor(raw);
    allocated += amt;
    return { ...b, amt, frac: raw - amt };
  });

  let leftover = totalYieldCents - allocated;
  allocs.sort((a, b) => {
    const fracDiff = b.frac - a.frac;
    if (fracDiff !== 0) return fracDiff;
    const balDiff = b.bal - a.bal;
    if (balDiff !== 0) return balDiff;
    return a.userId.localeCompare(b.userId);
  });
  for (let i = 0; i < allocs.length && leftover > 0; i++) {
    allocs[i].amt += 1;
    leftover -= 1;
  }

  let totalAllocated = 0;
  let allocatedUsers = 0;

  await prisma.$transaction(async (tx) => {
    for (const a of allocs) {
      if (a.amt <= 0) continue;

      const idempo = `yield_${runKey}_${a.userId}`;
      const existingAlloc = await tx.yieldAllocation.findUnique({
        where: { idempotencyKey: idempo },
      });
      if (existingAlloc) {
        totalAllocated += existingAlloc.amountCents;
        allocatedUsers += 1;
        continue;
      }

      await tx.journalEntry.create({
        data: {
          idempotencyKey: `je_${idempo}`,
          type: EntryType.YIELD_ACCRUED,
          metadata: { runKey, userId: a.userId, stashId: a.stashId },
          lines: {
            create: [
              { accountId: treasuryId, amountCents: -a.amt, memo: "Yield distributed" },
              { accountId: a.stashId, amountCents: a.amt, memo: "Stash grew" },
            ],
          },
        },
      });

      await tx.yieldAllocation.create({
        data: {
          yieldRunId: run.id,
          userId: a.userId,
          userStashAccountId: a.stashId,
          amountCents: a.amt,
          idempotencyKey: idempo,
        },
      });

      totalAllocated += a.amt;
      allocatedUsers += 1;
    }

    await tx.yieldRun.update({
      where: { id: run.id },
      data: { status: "POSTED" },
    });
  });

  return {
    ok: true,
    runKey,
    totalYieldCents,
    totalAllocated,
    allocatedUsers,
    leftover,
  };
});

app.get("/debug/stash-balances", async () => {
  const accounts = await prisma.account.findMany({
    where: { type: AccountType.USER_STASH },
    select: { id: true, userId: true },
  });

  const results = [];
  for (const acc of accounts) {
    const agg = await prisma.journalLine.aggregate({
      where: { accountId: acc.id },
      _sum: { amountCents: true },
    });
    results.push({
      userId: acc.userId ?? null,
      accountId: acc.id,
      balanceCents: agg._sum.amountCents ?? 0,
    });
  }
  return { count: results.length, accounts: results };
});

app.get("/debug/health/ledger", async (req, reply) => {
  const issues: string[] = [];
  let ok = true;

  const entries = await prisma.journalEntry.findMany({
    include: { lines: true },
  });
  for (const entry of entries) {
    const sum = entry.lines.reduce((s, l) => s + l.amountCents, 0);
    if (sum !== 0) {
      issues.push(`Entry ${entry.id} (idempotencyKey: ${entry.idempotencyKey}) lines sum to ${sum}, expected 0`);
      ok = false;
    }
  }

  const globalSum = await prisma.journalLine.aggregate({
    _sum: { amountCents: true },
  });
  const totalCents = globalSum._sum.amountCents ?? 0;
  if (totalCents !== 0) {
    issues.push(`Global sum of all journal lines is ${totalCents}, expected 0 (double-entry violation)`);
    ok = false;
  }

  const entryCount = await prisma.journalEntry.count();
  const distinctKeys = await prisma.journalEntry.groupBy({
    by: ["idempotencyKey"],
    _count: { id: true },
  });
  if (distinctKeys.length !== entryCount) {
    issues.push(`Idempotency key uniqueness: ${entryCount} entries but ${distinctKeys.length} distinct keys`);
    ok = false;
  }

  if (!ok) return reply.code(503).send({ ok: false, issues });
  return reply.send({ ok: true, checked: { entries: entryCount, globalSum: totalCents } });
});

// --- Feature flags & tiers (dev/admin) ---
app.post("/debug/seed/flags", async () => {
  const flags = [
    {
      key: "show_powered_by_base_badge",
      description: "Show Powered by Base badge",
      defaultEnabled: false,
    },
    {
      key: "show_view_onchain",
      description: "Show View onchain controls",
      defaultEnabled: false,
    },
    {
      key: "enable_self_custody_mode",
      description: "Allow smart wallet export/self-custody UI",
      defaultEnabled: false,
    },
    {
      key: "show_receipts",
      description: "Show onchain receipts/proofs",
      defaultEnabled: false,
    },
    {
      key: "show_yield_details_basic",
      description: "Show basic yield explainer",
      defaultEnabled: false,
    },
    {
      key: "show_yield_details_advanced",
      description: "Show advanced strategy breakdown",
      defaultEnabled: false,
    },
    {
      key: "enable_power_staking",
      description: "Enable power-user staking (approved assets)",
      defaultEnabled: false,
    },
  ];

  for (const f of flags) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { description: f.description, defaultEnabled: f.defaultEnabled },
      create: f,
    });
  }

  const policies = [
    // CURIOUS
    { tier: UserTier.CURIOUS, flagKey: "show_powered_by_base_badge", enabled: true },
    { tier: UserTier.CURIOUS, flagKey: "show_yield_details_basic", enabled: true },

    // POWER
    { tier: UserTier.POWER, flagKey: "show_powered_by_base_badge", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_view_onchain", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_receipts", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_yield_details_basic", enabled: true },
    { tier: UserTier.POWER, flagKey: "show_yield_details_advanced", enabled: true },
    { tier: UserTier.POWER, flagKey: "enable_power_staking", enabled: true },
  ];

  for (const p of policies) {
    await prisma.tierPolicy.upsert({
      where: { tier_flagKey: { tier: p.tier, flagKey: p.flagKey } },
      update: { enabled: p.enabled },
      create: p,
    });
  }

  return { ok: true };
});

app.get("/users/:userId/flags", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { flagOverrides: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const allFlags = await prisma.featureFlag.findMany();
  const tierPolicies = await prisma.tierPolicy.findMany({
    where: { tier: user.tier },
  });

  const baseMap = new Map(allFlags.map((f) => [f.key, f.defaultEnabled]));
  for (const p of tierPolicies) baseMap.set(p.flagKey, p.enabled);
  for (const o of user.flagOverrides) baseMap.set(o.flagKey, o.enabled);

  const payload = {
    userId,
    tier: user.tier,
    flags: Object.fromEntries(baseMap.entries()),
  };
  const etag = weakEtag("flags", stableStringify(payload));
  const cacheControl = "private, max-age=300";
  if (ifNoneMatch(req) === etag) {
    reply.code(304).header("ETag", etag).header("Cache-Control", cacheControl);
    return reply.send();
  }
  reply.header("ETag", etag).header("Cache-Control", cacheControl);
  return reply.send(payload);
});

const SetTierSchema = z.object({
  userId: z.string().uuid(),
  tier: z.nativeEnum(UserTier),
});

app.post("/admin/users/set-tier", async (req, reply) => {
  const parsed = SetTierSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const data: any = { tier: parsed.data.tier };
  if (parsed.data.tier === "POWER") {
    data.streakShieldAvailable = true;
  }
  const u = await prisma.user.update({
    where: { id: parsed.data.userId },
    data,
  });

  return { ok: true, userId: u.id, tier: u.tier };
});

// --- Challenge Engine v1 ---

app.post("/debug/seed/challenges", async () => {
  const templates = [
    {
      slug: "52_week",
      name: "52-Week Challenge",
      defaultRules: {
        type: "weekly_increment",
        week1AmountCents: 100,
        incrementCents: 100,
        maxWeeks: 52,
        weekday: 1,
        schedule: { type: "weekly", dayOfWeek: "MON", catchUp: true },
      },
    },
    {
      slug: "weather_wednesday",
      name: "Weather Wednesday",
      defaultRules: {
        type: "weather_wednesday",
        schedule: {
          type: "weekday",
          daysOfWeek: ["WED"],
          timeOfDayLocal: "09:00",
          catchUp: true,
        },
        amount: {
          mode: "choice",
          maxAmountCents: 2000,
          scale: 1,
          prompt: "How’s the weather today?",
          options: [
            { choice: "Sunny", amountCents: 500 },
            { choice: "Cloudy", amountCents: 700 },
            { choice: "Rainy", amountCents: 1000 },
          ],
          defaultAmountCents: 700,
        },
        autoCommitDefault: false,
      },
    },
    {
      slug: "temperature_daily",
      name: "Temperature Challenge",
      defaultRules: {
        type: "temperature",
        schedule: { type: "daily", catchUp: true },
        autoCommitDefault: false,
        amount: {
          mode: "temperature",
          unit: "F",
          scale: 1,
          maxAmountCents: 50000,
          prompt: "Save today’s temperature",
        },
      },
    },
    {
      slug: "dice_daily",
      name: "Roll the Dice",
      defaultRules: {
        type: "dice",
        schedule: { type: "daily", catchUp: true },
        autoCommitDefault: false,
        amount: {
          mode: "dice",
          sides: 6,
          unitAmountCents: 100,
          maxAmountCents: 2000,
          prompt: "Roll to save today",
        },
      },
    },
    {
      slug: "100_envelopes",
      name: "100 Envelopes Challenge",
      defaultRules: {
        type: "envelopes",
        min: 1,
        max: 100,
        unitAmountCents: 100,
      },
    },
    {
      slug: "dice",
      name: "Roll-the-Dice",
      defaultRules: {
        type: "dice",
        sides: 6,
        unitAmountCents: 100,
      },
    },
  ];

  for (const t of templates) {
    await prisma.challengeTemplate.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        defaultRules: t.defaultRules as any,
      },
      create: {
        slug: t.slug,
        name: t.name,
        defaultRules: t.defaultRules as any,
      },
    });
  }

  return { ok: true };
});

app.get("/debug/challenges", async () => {
  return prisma.userChallenge.findMany({ include: { template: true, events: true } });
});

app.get("/debug/challenges/:id", async (req, reply) => {
  const id = (req.params as any).id as string;
  const uc = await prisma.userChallenge.findUnique({
    where: { id },
  });
  if (!uc) return reply.code(404).send({ error: "Not found" });
  return { id: uc.id, status: uc.status, state: uc.state, rules: uc.rules };
});

app.get("/debug/users/:userId/payment-intents", async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const paymentIntents = await prisma.paymentIntent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { userId, paymentIntents };
});

app.get("/users/:userId/config", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tier: true, flags: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const flags = resolveFlags(user.tier as any, user.flags);
  const payload = { userId: user.id, tier: user.tier, flags };
  const etag = weakEtag("cfg", stableStringify(payload));
  const cacheControl = "private, max-age=300";
  if (ifNoneMatch(req) === etag) {
    reply.code(304).header("ETag", etag).header("Cache-Control", cacheControl);
    return reply.send();
  }
  reply.header("ETag", etag).header("Cache-Control", cacheControl);
  return reply.send(payload);
});

app.get("/users/:userId/stash/value", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const stashId = await getUserStashAccountId(userId);

  const stashAgg = await prisma.journalLine.aggregate({
    where: { accountId: stashId },
    _sum: { amountCents: true },
  });
  const stashBalanceCents = stashAgg._sum.amountCents ?? 0;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true },
  });
  const flags = resolveFlags((user?.tier as any) ?? "NORMIE", user?.flags);

  const vp = await prisma.vaultPosition.findUnique({ where: { userId } });
  const vaultMicros = vp?.currentValueUsdcMicros ? BigInt(vp.currentValueUsdcMicros) : 0n;
  const vaultValueCents = Number(vaultMicros / 10_000n);
  const totalDisplayCents = stashBalanceCents + vaultValueCents;

  const resp: any = {
    userId,
    stashBalanceCents,
    vaultValueCents,
    totalDisplayCents,
    lastMarkedAt: vp?.lastMarkedAt ?? null,
  };

  if (vp?.lastMarkedAt) {
    const ageMs = Date.now() - vp.lastMarkedAt.getTime();
    resp.markAgeSeconds = Math.floor(ageMs / 1000);
    resp.isStale = ageMs > 5 * 60 * 1000; // 5 minutes threshold
  } else {
    resp.markAgeSeconds = null;
    resp.isStale = true;
  }

  if (flags.showVaultShares) {
    resp.vaultShares = vp?.shares ?? null;
    resp.vaultValueUsdcMicros = vp?.currentValueUsdcMicros ?? null;
    resp.vaultAddress = vp?.vaultAddress ?? null;
  }

  if (flags.showChainName || flags.showYieldSource) {
    const latestAction = await prisma.onchainAction.findFirst({
      where: { userId, txHash: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    if (flags.showChainName) resp.chain = latestAction?.chain ?? null;
    if (flags.showYieldSource) resp.yieldSource = "USDC Vault";
    if (flags.showTxHistory) resp.lastTxHash = latestAction?.txHash ?? null;
  }

  return resp;
});

function toCentsFromMicros(micros?: string | null) {
  if (!micros) return null;
  const v = BigInt(micros);
  return Number(v / 10_000n);
}

function shortAddr(addr?: string | null) {
  if (!addr) return null;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatChallengeDetail(uc?: any, ev?: any) {
  const rules = (uc?.rules as any) ?? (uc?.template as any)?.defaultRules;
  const meta = (ev?.metadata as any) ?? {};
  const type = rules?.type;

  if (type === "envelopes") {
    if (meta.envelope) return `Envelope ${meta.envelope}`;
  } else if (type === "dice") {
    if (meta.roll) return `Rolled ${meta.roll}`;
  } else if (type === "weekly_increment") {
    const wk = meta.weeksSinceStart ?? meta.week ?? meta.weekNumber;
    if (wk) return `Week ${wk}`;
  } else if (type === "weather_wednesday") {
    if (typeof meta.tempF === "number") return `${meta.tempF}°F`;
    if (typeof meta.tempC === "number") return `${meta.tempC}°C`;
    if (meta.weather) return String(meta.weather);
    if (meta.weekday) return String(meta.weekday);
    return "Wednesday";
  } else if (type === "temperature") {
    if (typeof meta.tempF === "number") return `${meta.tempF}°F`;
    if (typeof meta.tempC === "number") return `${meta.tempC}°C`;
    if (meta.weekday) return String(meta.weekday);
  }

  return null;
}

app.get("/users/:userId/activity", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const limit = Math.min(Number((req.query as any).limit ?? 50), 100);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vaultPosition: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const flags = resolveFlags(user.tier as any, user.flags);

  const [pis, actions] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    flags.showTxHistory
      ? prisma.onchainAction.findMany({
          where: { userId },
          take: limit,
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const challengePis = pis.filter(
    (pi) => (pi.metadata as any)?.source === "challenge",
  );
  const ucIds = Array.from(
    new Set(
      challengePis
        .map((pi) => (pi.metadata as any)?.userChallengeId as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const evIds = Array.from(
    new Set(
      challengePis
        .map((pi) => (pi.metadata as any)?.challengeEventId as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [ucs, evs] = await Promise.all([
    ucIds.length
      ? prisma.userChallenge.findMany({
          where: { id: { in: ucIds } },
          include: { template: true },
        })
      : Promise.resolve([]),
    evIds.length
      ? prisma.challengeEvent.findMany({
          where: { id: { in: evIds } },
        })
      : Promise.resolve([]),
  ]);

  const userChallengesById = new Map(ucs.map((x) => [x.id, x]));
  const challengeEventsById = new Map(evs.map((x) => [x.id, x]));

  const events: any[] = [];

  for (const pi of pis) {
    if (pi.type === "DEPOSIT" && pi.status === "SETTLED") {
      const source = (pi.metadata as any)?.source;
      if (source === "challenge") {
        const userChallengeId = (pi.metadata as any)?.userChallengeId;
        const challengeEventId = (pi.metadata as any)?.challengeEventId;
        const uc = userChallengesById.get(userChallengeId);
        const ev = challengeEventsById.get(challengeEventId);
        const name = uc?.name ?? uc?.template?.name ?? "Challenge";
        const detail = formatChallengeDetail(uc, ev);

        events.push({
          id: `pi_${pi.id}`,
          at: pi.updatedAt ?? pi.createdAt,
          category: "challenge",
          title: `Challenge saved $${(pi.amountCents / 100).toFixed(0)}`,
          subtitle: detail ? `${name} - ${detail}` : name,
          amountCents: pi.amountCents,
          meta: {
            challengeSlug: uc?.template?.slug,
            userChallengeId,
            challengeEventId,
          },
        });
        continue;
      }

      events.push({
        id: `pi_${pi.id}`,
        at: pi.updatedAt ?? pi.createdAt,
        category: "deposit",
        title: "Deposit added",
        subtitle: "Added to your stash.",
        amountCents: pi.amountCents,
        meta: {},
      });
    }

    if (pi.type === "WITHDRAW") {
      const rail = (pi.metadata as any)?.rail ?? "BANK";
      const isOnchain = rail === "ONCHAIN";
      const recipient = (pi.metadata as any)?.recipient;

      if (pi.status === "PROCESSING") {
        events.push({
          id: `pi_${pi.id}`,
          at: pi.updatedAt ?? pi.createdAt,
          category: "withdraw",
          title: "Withdrawal requested",
          subtitle: isOnchain
            ? `Sending to ${shortAddr(recipient) ?? "your wallet"}.`
            : "Sending to your bank.",
          amountCents: -pi.amountCents,
          meta:
            flags.enableOnchainWithdrawToWallet && isOnchain && recipient
              ? { recipient }
              : {},
        });
      } else if (pi.status === "SETTLED" || (pi as any).status === "PAID") {
        events.push({
          id: `pi_${pi.id}`,
          at: pi.updatedAt ?? pi.createdAt,
          category: "withdraw",
          title: "Withdrawal completed",
          subtitle: isOnchain
            ? `Sent to ${shortAddr(recipient) ?? "your wallet"}.`
            : "Sent to your bank.",
          amountCents: -pi.amountCents,
          meta: {},
        });
      }
    }
  }

  for (const a of actions as any[]) {
    const meta = (a.metadata as any) ?? {};

    if (a.type === "VAULT_DEPOSIT" && a.status === "CONFIRMED") {
      events.push({
        id: `oa_${a.id}`,
        at: a.updatedAt ?? a.createdAt,
        category: "stash",
        title: flags.showCryptoLabels ? "Vault deposit confirmed" : "Stash is earning",
        subtitle: flags.showCryptoLabels
          ? `shares minted: ${meta?.depositEvent?.sharesMinted ?? "?"}`
          : "Your stash is growing automatically.",
        amountCents: null,
    meta: flags.showTxHistory
      ? {
          txHash: a.txHash,
          chain: a.chain,
          ...(flags.showCryptoLabels
            ? { sharesMinted: meta?.depositEvent?.sharesMinted }
            : {}),
        }
      : {},
      });
    }

    if (a.type === "VAULT_WITHDRAW_REQUEST" && a.status === "CONFIRMED") {
      events.push({
        id: `oa_${a.id}`,
        at: a.updatedAt ?? a.createdAt,
        category: "withdraw",
        title: "Preparing withdrawal",
        subtitle: flags.showCryptoLabels
          ? `requestId: ${a.requestId}`
          : "Getting funds ready.",
        amountCents: null,
    meta: flags.showTxHistory
      ? {
          txHash: a.txHash,
          chain: a.chain,
          ...(flags.showCryptoLabels
            ? { requestId: a.requestId, recipient: meta?.recipient }
            : { recipient: meta?.recipient ? shortAddr(meta.recipient) : undefined }),
        }
      : {},
      });
    }

    if (a.type === "VAULT_REDEEM" && a.status === "CONFIRMED") {
      const usdcAmount = meta?.withdrawRedeemedEvent?.usdcAmount ?? meta?.usdcAmount;
      events.push({
        id: `oa_${a.id}`,
        at: a.updatedAt ?? a.createdAt,
        category: "withdraw",
        title: "Withdrawal funds released",
        subtitle: flags.showCryptoLabels
          ? `usdc: ${usdcAmount ?? "?"}`
          : "Funds released successfully.",
        amountCents: flags.showCryptoLabels && usdcAmount ? toCentsFromMicros(usdcAmount) : null,
    meta: flags.showTxHistory
      ? {
          txHash: a.txHash,
          chain: a.chain,
          ...(flags.showCryptoLabels
            ? { usdcAmount, requestId: meta?.requestId, recipient: meta?.recipient }
            : {}),
        }
      : {},
      });
    }
  }

  if (user.vaultPosition?.lastMarkedAt) {
    events.push({
      id: `mark_${userId}_${new Date(user.vaultPosition.lastMarkedAt).getTime()}`,
      at: user.vaultPosition.lastMarkedAt,
      category: "stash",
      title: "Stash updated",
      subtitle: "Your stash value refreshed.",
      amountCents: null,
      meta: {},
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return reply.send({ userId, events: events.slice(0, limit) });
});

async function buildTodayCards(
  userId: string,
  now: Date,
): Promise<{ cards: any[]; banner: any }> {
  const todayStr = toDateStringUtc(now);
  const cacheKey = `today:${userId}:${todayStr}`;
  const cached = todayCardsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const dayStart = utcDateOnly(now);
  const dayEnd = addDaysUtc(dayStart, 1);

  const ucs = await prisma.userChallenge.findMany({
    where: { userId, status: "ACTIVE" },
    include: { template: true },
  });

  const pendingEvents = await prisma.challengeEvent.findMany({
    where: {
      userChallenge: { userId, status: "ACTIVE" },
      paymentIntentId: null,
      scheduledFor: { gte: dayStart, lt: dayEnd },
      amountCents: null,
    },
    orderBy: { scheduledFor: "asc" },
  });

  const pendingCount = await prisma.challengeEvent.count({
    where: {
      userChallenge: { userId, status: "ACTIVE" },
      paymentIntentId: null,
      scheduledFor: { lte: now },
      amountCents: { gt: 0 },
    },
  });
  const pendingInputCount = await prisma.challengeEvent.count({
    where: {
      userChallenge: { userId, status: "ACTIVE" },
      paymentIntentId: null,
      scheduledFor: { lte: now },
      amountCents: null,
    },
  });

  const ucById = new Map(ucs.map((uc) => [uc.id, uc]));
  const cards: any[] = [];

  for (const ev of pendingEvents) {
    const uc = ucById.get(ev.userChallengeId);
    const rules = (uc?.rules as any) ?? (uc?.template as any)?.defaultRules ?? {};
    const amount = rules.amount ?? {};

    if (rules.type === "weather_wednesday") {
      const options = Array.isArray(amount.options) ? amount.options : [];
      cards.push({
        type: "weather_wednesday",
        eventId: ev.id,
        challengeId: ev.userChallengeId,
        title: uc?.name ?? "Weather Wednesday",
        prompt: amount.prompt ?? "How’s the weather today?",
        unit: amount.unit ?? "F",
        scale: amount.scale ?? 1,
        choices: options.map((o: any) => ({
          choice: o.choice ?? o.label,
          amountCents: o.amountCents,
        })),
        scheduledFor: ev.scheduledFor.toISOString(),
        needsInput: true,
        maxAmountCents: amount.maxAmountCents ?? 2000,
      });
    } else if (rules.type === "temperature") {
      const settings = (uc?.settings as any) ?? {};
      const override = Number(settings.scaleOverride);
      const effectiveScale =
        override === 1 || override === 10 ? override : Number(amount.scale ?? 1);

      cards.push({
        type: "temperature_daily",
        eventId: ev.id,
        challengeId: ev.userChallengeId,
        userChallengeId: ev.userChallengeId,
        title: uc?.name ?? "Temperature Challenge",
        prompt: amount.prompt ?? "Save today’s temperature",
        unit: amount.unit ?? "F",
        scale: effectiveScale,
        availableScales: [1, 10],
        scheduledFor: ev.scheduledFor.toISOString(),
        needsInput: true,
        maxAmountCents: amount.maxAmountCents ?? 50000,
      });
    } else if (rules.type === "dice") {
      cards.push({
        type: "dice_daily",
        eventId: ev.id,
        challengeId: ev.userChallengeId,
        userChallengeId: ev.userChallengeId,
        title: uc?.name ?? "Roll the Dice",
        prompt: amount.prompt ?? "Roll to save today",
        sides: amount.sides ?? 6,
        unitAmountCents: amount.unitAmountCents ?? 100,
        scheduledFor: ev.scheduledFor.toISOString(),
        needsInput: true,
        maxAmountCents: amount.maxAmountCents ?? 2000,
        ...(amount.multiDice >= 2 && { multiDice: 2 }),
        ...(amount.multiplier >= 10 && { multiplier: 10 }),
      });
    }
  }

  // Interactive anytime: 100 Envelopes (not scheduled by date)
  const dayStartForEnvelopes = utcDateOnly(now);
  const dayEndForEnvelopes = addDaysUtc(dayStartForEnvelopes, 1);
  for (const uc of ucs) {
    const templateSlug = (uc.template as any)?.slug;
    if (templateSlug !== "100_envelopes" || uc.status !== "ACTIVE") continue;
    const state = (uc as any).state as { remaining?: number[]; used?: number[] } | null;
    const remaining = state?.remaining ?? [];
    if (remaining.length === 0) continue;
    const rules = (uc.rules as any) ?? {};
    const min = Number(rules.min ?? 1);
    const max = Number(rules.max ?? 100);
    const usedCount = state?.used?.length ?? 0;
    const cadence = rules.cadence ?? "daily";
    const maxDrawsPerDay = Number(rules.maxDrawsPerDay ?? 1);
    let drewToday = false;
    let canDraw = false;
    if (cadence === "weekly") {
      const weekStart = startOfWeekUtc(now);
      const weekEnd = addDaysUtc(weekStart, 7);
      const drawsThisWeek = await prisma.challengeEvent.count({
        where: {
          userChallengeId: uc.id,
          createdAt: { gte: weekStart, lt: weekEnd },
        },
      });
      canDraw = drawsThisWeek < 1;
      drewToday = drawsThisWeek >= 1;
    } else {
      const drawsTodayCount = await prisma.challengeEvent.count({
        where: {
          userChallengeId: uc.id,
          createdAt: { gte: dayStartForEnvelopes, lt: dayEndForEnvelopes },
        },
      });
      drewToday = drawsTodayCount >= maxDrawsPerDay;
      canDraw = !drewToday;
    }
    if (canDraw) {
      cards.push({
        type: "envelopes_100",
        title: uc?.name ?? "100 Envelopes",
        prompt: "Draw an envelope to save",
        needsInput: true,
        challengeId: uc.id,
        userChallengeId: uc.id,
        remainingCount: remaining.length,
        usedCount,
        min,
        max,
        unitAmountCents: Number(rules.unitAmountCents ?? 100),
        maxDrawsPerDay: cadence === "weekly" ? 0 : maxDrawsPerDay,
        drewToday,
        ...(cadence === "weekly" && { cadence: "weekly" }),
        ...(rules.order === "reverse" && { order: "reverse" }),
      });
    }
  }

  const banner =
    pendingCount > 0
      ? {
          type: "commit_pending",
          pendingCount,
          label: "Catch up your saves",
          subLabel: "Apply what you missed (up to your daily cap)",
        }
      : pendingInputCount > 0
        ? {
            type: "needs_input",
            pendingCount: pendingInputCount,
            label: "Complete today’s saves",
            subLabel: "Tap a card to finish today’s save.",
          }
        : undefined;

  todayCardsCache.set(cacheKey, {
    data: { cards, banner },
    expiresAt: Date.now() + TODAY_CARDS_CACHE_TTL_MS,
  });
  return { cards, banner };
}

/** Message hints for push worker (no need to know every challenge type). */
function reminderMessageHints(
  name: string,
  templateSlug: string | null,
  expectedAction: "draw" | "roll" | "input" | "save",
): { title: string; body: string; deeplink: string } {
  const baseTitle = name || "Your challenge";
  const deeplink = "/";
  switch (expectedAction) {
    case "roll":
      return { title: baseTitle, body: "Tap to roll and save today.", deeplink };
    case "input":
      return { title: baseTitle, body: "Tap to log today's save.", deeplink };
    case "draw":
      return { title: baseTitle, body: "Draw an envelope to save.", deeplink };
    case "save":
      return { title: baseTitle, body: "Complete this week's save.", deeplink };
    default:
      return { title: baseTitle, body: "Tap to complete your save.", deeplink };
  }
}

/** Challenge-aware reminder eligibility: due, not completed for this window, reminder not yet sent. Used by push job. */
export type RemindableChallenge = {
  userChallengeId: string;
  dueWindowKey: string;
  expectedAction: "draw" | "roll" | "input" | "save";
  name: string;
  templateSlug: string | null;
  title: string;
  body: string;
  deeplink: string;
};

async function getRemindableChallenges(
  userId: string,
  now: Date,
): Promise<RemindableChallenge[]> {
  const dayStart = utcDateOnly(now);
  const dayEnd = addDaysUtc(dayStart, 1);

  const ucs = await prisma.userChallenge.findMany({
    where: { userId, status: "ACTIVE" },
    include: { template: true },
  });

  const out: RemindableChallenge[] = [];

  for (const uc of ucs) {
    const rules = (uc.rules as any) ?? {};
    const templateSlug = (uc.template as any)?.slug ?? null;

    let envelopeDrewToday = false;
    let envelopeState: { remaining?: number[]; used?: number[] } | null = null;
    if (templateSlug === "100_envelopes" || rules.type === "envelopes") {
      const state = (uc.state as { remaining?: number[]; used?: number[] }) ?? null;
      envelopeState = state;
      const drawsToday = await prisma.challengeEvent.count({
        where: {
          userChallengeId: uc.id,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      });
      envelopeDrewToday = drawsToday >= 1;
    }

    const dueResult = getChallengeDueWindow({
      templateSlug,
      rules,
      startDate: uc.startDate,
      nowUtc: now,
      envelopeState,
      envelopeDrewToday,
    });

    if (!dueResult.due || !dueResult.dueWindowKey) continue;

    const completed =
      dueResult.expectedAction === "draw"
        ? envelopeDrewToday
        : await prisma.challengeEvent.count({
            where: {
              userChallengeId: uc.id,
              scheduledFor: { gte: dueResult.dueSinceUtc!, lt: dueResult.dueUntilUtc! },
              paymentIntentId: { not: null },
            },
          }) >= 1;

    if (completed) continue;

    const sent = await prisma.challengeReminder.findUnique({
      where: {
        userChallengeId_dueWindowKey_channel: {
          userChallengeId: uc.id,
          dueWindowKey: dueResult.dueWindowKey,
          channel: "PUSH",
        },
      },
    });
    if (sent) continue;

    const hints = reminderMessageHints(uc.name, templateSlug, dueResult.expectedAction);
    out.push({
      userChallengeId: uc.id,
      dueWindowKey: dueResult.dueWindowKey,
      expectedAction: dueResult.expectedAction,
      name: uc.name,
      templateSlug,
      title: hints.title,
      body: hints.body,
      deeplink: hints.deeplink,
    });
  }

  return out;
}

app.get("/users/:userId/challenges/remindable", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const now = new Date();
  const list = await getRemindableChallenges(userId, now);
  return reply.send({ userId, remindable: list });
});

app.get("/users/:userId/challenges/today", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const runDueResult = await runDueForUser(userId);
  if (!runDueResult) return reply.code(404).send({ error: "User not found" });
  const now = new Date();
  const { cards, banner } = await buildTodayCards(userId, now);
  reply.header("X-Build", BUILD_TIMESTAMP);
  reply.header("Cache-Control", "no-store");
  return reply.send({ userId, banner, cards });
});

app.get("/users/:userId/challenges/active", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const r = await getActiveChallengesForUser(userId);
  const etag = weakEtag("active", stableStringify(r));
  const cacheControl = "private, max-age=15";
  if (ifNoneMatch(req) === etag) {
    reply.code(304).header("ETag", etag).header("Cache-Control", cacheControl);
    return reply.send();
  }
  reply.header("ETag", etag).header("Cache-Control", cacheControl);
  return reply.send(r);
});

async function getActiveChallengesForUser(userId: string): Promise<{
  userId: string;
  challenges: Array<{ userChallengeId: string; name: string; templateSlug: string | null; progress?: string }>;
}> {
  const ucs = await prisma.userChallenge.findMany({
    where: { userId, status: "ACTIVE" },
    include: { template: true },
  });
  const list = ucs.map((uc) => {
    const name = uc?.name ?? (uc.template as any)?.name ?? "Challenge";
    const slug = (uc.template as any)?.slug ?? null;
    let progress: string | undefined;
    const rules = (uc.rules as any) ?? {};
    if (rules.type === "envelopes") {
      const state = (uc as any).state as { used?: number[] } | null;
      const used = state?.used?.length ?? 0;
      const total = Number(rules.max ?? 100) - Number(rules.min ?? 1) + 1;
      progress = `${used}/${total}`;
    }
    return { userChallengeId: uc.id, name, templateSlug: slug, progress };
  });
  return { userId, challenges: list };
}

async function getChallengeSavesCountForDate(userId: string, dateStr: string): Promise<number> {
  const dayStart = new Date(dateStr + "T00:00:00.000Z");
  const dayEnd = addDaysUtc(dayStart, 1);
  return prisma.paymentIntent.count({
    where: {
      userId,
      type: "DEPOSIT",
      status: "SETTLED",
      createdAt: { gte: dayStart, lt: dayEnd },
      metadata: { path: ["source"], equals: "challenge" },
    },
  });
}

async function getStreakForUser(userId: string): Promise<{
  userId: string;
  todayCompleted: boolean;
  currentStreakDays: number;
  bestStreakDays: number;
  lastCompletedDateUtc: string | null;
  streakStatus: "ok" | "needs_recovery" | "decayed";
  streakShieldAvailable: boolean;
  streakShieldUsedAtUtc: string | null;
  recoveryTarget: number | null;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tier: true,
      currentStreakDays: true,
      bestStreakDays: true,
      lastStreakDateUtc: true,
      streakShieldAvailable: true,
      streakShieldUsedAtUtc: true,
    },
  });
  if (!user) return null;

  const now = new Date();
  const dayStart = utcDateOnly(now);
  const dayEnd = addDaysUtc(dayStart, 1);
  const todayStr = toDateStringUtc(now);
  const yesterdayStr = toDateStringUtc(addDaysUtc(dayStart, -1));

  const todayCount = await getChallengeSavesCountForDate(userId, todayStr);
  const todayCompleted = todayCount >= 1;

  const u = user as any;
  const tier = u.tier ?? "NORMIE";
  const last = u.lastStreakDateUtc ?? null;
  const storedCurrent = u.currentStreakDays ?? 0;
  const best = u.bestStreakDays ?? 0;
  let streakShieldAvailable = Boolean(u.streakShieldAvailable);
  let streakShieldUsedAtUtc: string | null = u.streakShieldUsedAtUtc ?? null;

  const streakValid = last === todayStr || last === yesterdayStr;
  let currentStreakDays = storedCurrent;
  let streakStatus: "ok" | "needs_recovery" | "decayed" = "ok";
  let recoveryTarget: number | null = null;

  if (!streakValid && storedCurrent > 0) {
    const isPower = tier === "POWER" || tier === "DEV";
    const missedDay = yesterdayStr;

    if (isPower && streakShieldAvailable && !streakShieldUsedAtUtc) {
      streakShieldUsedAtUtc = missedDay;
      await prisma.user.update({
        where: { id: userId },
        data: { streakShieldUsedAtUtc: missedDay } as any,
      });
      streakStatus = "needs_recovery";
      recoveryTarget = 2;
    } else if (isPower && streakShieldUsedAtUtc) {
      const recoveryDay = toDateStringUtc(addDaysUtc(new Date(streakShieldUsedAtUtc + "T12:00:00.000Z"), 1));
      if (todayStr > recoveryDay) {
        const recoverySaves = await getChallengeSavesCountForDate(userId, recoveryDay);
        if (recoverySaves >= 2) {
          streakShieldAvailable = false;
          streakShieldUsedAtUtc = null;
          await prisma.user.update({
            where: { id: userId },
            data: { streakShieldAvailable: false, streakShieldUsedAtUtc: null } as any,
          });
        } else {
          currentStreakDays = 0;
          streakShieldAvailable = false;
          streakShieldUsedAtUtc = null;
          streakStatus = "decayed";
          await prisma.user.update({
            where: { id: userId },
            data: { currentStreakDays: 0, streakShieldAvailable: false, streakShieldUsedAtUtc: null } as any,
          });
        }
      } else if (todayStr === recoveryDay) {
        streakStatus = "needs_recovery";
        recoveryTarget = 2;
      }
    } else {
      if (streakShieldUsedAtUtc) {
        await prisma.user.update({
          where: { id: userId },
          data: { currentStreakDays: 0, streakShieldUsedAtUtc: null } as any,
        });
      } else {
        await prisma.user.update({
          where: { id: userId },
          data: { currentStreakDays: 0 } as any,
        });
      }
      currentStreakDays = 0;
      streakStatus = "decayed";
    }
  } else if (streakValid && streakShieldUsedAtUtc && (tier === "POWER" || tier === "DEV") && todayStr === toDateStringUtc(addDaysUtc(new Date(streakShieldUsedAtUtc + "T12:00:00.000Z"), 1))) {
    streakStatus = "needs_recovery";
    recoveryTarget = 2;
  }

  return {
    userId,
    todayCompleted,
    currentStreakDays,
    bestStreakDays: best,
    lastCompletedDateUtc: last,
    streakStatus,
    streakShieldAvailable,
    streakShieldUsedAtUtc,
    recoveryTarget,
  };
}

app.get("/users/:userId/streak", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const r = await getStreakForUser(userId);
  if (!r) return reply.code(404).send({ error: "User not found" });
  const etag = weakEtag("streak", stableStringify(r));
  const cacheControl = "private, max-age=30";
  if (ifNoneMatch(req) === etag) {
    reply.code(304).header("ETag", etag).header("Cache-Control", cacheControl);
    return reply.send();
  }
  reply.header("ETag", etag).header("Cache-Control", cacheControl);
  return reply.send(r);
});

app.get("/users/:userId/home", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const startTime = Date.now();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true, wallet: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  await runDueForUser(userId);

  const [streak, today, activeChallenges] = await Promise.all([
    getStreakForUser(userId),
    buildTodayCards(userId, new Date()),
    getActiveChallengesForUser(userId),
  ]);
  if (!streak) return reply.code(404).send({ error: "User not found" });

  let stashAccountId: string;
  try {
    stashAccountId = await getUserStashAccountId(userId);
  } catch {
    return reply.code(404).send({ error: "User stash not found" });
  }
  const stashAgg = await prisma.journalLine.aggregate({
    where: { accountId: stashAccountId },
    _sum: { amountCents: true },
  });
  const stashBalanceCents = stashAgg._sum.amountCents ?? 0;

  const vp = await prisma.vaultPosition.findUnique({ where: { userId } });
  const vaultMicros = vp?.currentValueUsdcMicros ? BigInt(vp.currentValueUsdcMicros) : 0n;
  const vaultValueCents = Number(vaultMicros / 10_000n);
  const totalDisplayCents = stashBalanceCents + vaultValueCents;

  const config = {
    tier: user.tier,
    flags: resolveFlags(user.tier as any, user.flags),
  };
  const flags = config.flags as Record<string, boolean>;
  const { wallet, funding } = buildWalletAndFunding(user, flags);

  const stash: Record<string, unknown> = {
    stashBalanceCents,
    vaultValueCents,
    totalDisplayCents,
    lastMarkedAt: vp?.lastMarkedAt ?? null,
    markAgeSeconds: vp?.lastMarkedAt
      ? Math.floor((Date.now() - vp.lastMarkedAt.getTime()) / 1000)
      : null,
    isStale: !vp?.lastMarkedAt || Date.now() - vp.lastMarkedAt.getTime() > 5 * 60 * 1000,
  };
  if (flags.showVaultShares || flags.showChainName || flags.showYieldSource || flags.showTxHistory) {
    const latestAction = await prisma.onchainAction.findFirst({
      where: { userId, txHash: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    (stash as any).details = {
      ...(flags.showVaultShares && {
        vaultShares: vp?.shares ?? null,
        vaultValueUsdcMicros: vp?.currentValueUsdcMicros ?? null,
        vaultAddress: vp?.vaultAddress ?? null,
      }),
      ...(flags.showChainName && { chain: latestAction?.chain ?? "base" }),
      ...(flags.showYieldSource && { yieldSource: "USDC Vault" }),
      ...(flags.showTxHistory && { lastTxHash: latestAction?.txHash ?? null }),
    };
  }

  const payload = {
    userId,
    config,
    wallet,
    funding,
    streak,
    stash,
    stashAccountId,
    today: { cards: today.cards, banner: today.banner },
    activeChallenges: activeChallenges.challenges,
  };

  app.log.info({
    route: "GET /users/:userId/home",
    userId,
    durationMs: Date.now() - startTime,
    cardsCount: today.cards.length,
    bannerType: today.banner?.type,
  });

  reply.header("X-Build", BUILD_TIMESTAMP);
  reply.header("Cache-Control", "no-store");
  return reply.send(payload);
});

// --- Funding session token (for FundCard/FundButton; 501 until CDP keys set) ---
const FundingSessionSchema = z.object({
  returnTo: z.string().optional(),
  context: z.enum(["pwa", "miniapp"]).optional(),
});

app.post("/funding/session", { preHandler: [requireAuth] }, async (req, reply) => {
  const userId = (req as any).user?.id;
  if (!userId) return reply.code(401).send({ error: "unauthorized" });

  const uw = await prisma.userWallet.findUnique({ where: { userId } });
  if (!uw) {
    return reply.code(409).send({ error: "wallet_not_ready" });
  }

  if (!isFundingConfigured()) {
    return reply.code(503).send({ error: "funding_disabled" });
  }

  const fundingProvider = (env.data.FUNDING_PROVIDER ?? "").toLowerCase();
  const projectId = env.data.CDP_PROJECT_ID?.trim();
  const apiKey = env.data.CDP_API_KEY?.trim();
  if (fundingProvider !== "coinbase" || !isCdpConfigured(projectId, apiKey)) {
    return reply.code(501).send({ error: "funding_session_not_configured" });
  }

  if (!checkRateLimit(`funding_session:${userId}`, rateLimitFundingSession, RATE_LIMIT_FUNDING_SESSION)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }

  const parsed = FundingSessionSchema.safeParse((req.body as any) ?? {});
  const returnTo = parsed.success ? sanitizeReturnTo(parsed.data.returnTo) ?? undefined : undefined;
  const context = parsed.success ? parsed.data.context : undefined;
  if (context) {
    app.log.info({ userId, context }, "funding/session context");
  }

  const clientIp = getClientIP(req);
  const ttlMinutes = env.data.FUNDING_SESSION_TTL_MIN ?? 10;
  const result = await createFundingSession({
    userId,
    walletAddress: uw.address,
    chain: uw.chain,
    returnTo: returnTo ?? null,
    context,
    clientIp,
    apiKey: apiKey!,
    ttlMinutes,
  });

  if (!result.ok) {
    app.log.warn({ userId, statusCode: result.statusCode, error: result.error }, "CDP session token failed");
    return reply.code(503).send({ error: "session_token_failed" });
  }

  reply.header("Cache-Control", "no-store");
  reply.header("X-Build", BUILD_TIMESTAMP);
  return reply.send({
    provider: "coinbase",
    enabled: true,
    sessionToken: result.sessionToken,
    expiresAt: result.expiresAt,
    wallet: { chain: uw.chain, address: uw.address },
    ui: { mode: "fundcard", title: "Add money", asset: "USDC" },
  });
});

// --- Funding refresh: turn wallet USDC balance into ledger deposit intents (idempotent) ---
app.post("/users/:userId/funding/refresh", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  if (!isFundingConfigured()) {
    return reply.code(503).send({ error: "funding_disabled" });
  }
  if (!checkRateLimit(`funding_refresh:${userId}`, rateLimitFundingRefresh, RATE_LIMIT_FUNDING_REFRESH)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }

  const uw = await prisma.userWallet.findUnique({ where: { userId } });
  if (!uw) {
    return reply.code(409).send({ error: "wallet_not_ready" });
  }

  const balanceMicros = await getUsdcBalanceMicros(uw.address);
  if (balanceMicros === null) {
    return reply.code(503).send({ error: "chain_unavailable" });
  }

  const accountedBefore = BigInt(uw.accountedPrincipalUsdcMicros ?? "0");
  const deltaMicros = balanceMicros > accountedBefore ? balanceMicros - accountedBefore : 0n;
  const deltaCents = Math.floor(Number(deltaMicros / 10_000n));
  const minCents = MIN_DEPOSIT_CENTS;
  const maxCents = Math.min(MAX_DEPOSIT_CENTS, deltaCents);
  const asOf = new Date();

  const updateRefreshMeta = () =>
    prisma.userWallet.update({
      where: { userId },
      data: {
        lastFundingRefreshAt: asOf,
        lastObservedBalanceMicros: balanceMicros.toString(),
      },
    });

  if (maxCents < minCents) {
    await updateRefreshMeta();
    return reply.send({
      userId,
      wallet: { chain: uw.chain, address: uw.address },
      observed: { walletUsdcBalanceMicros: balanceMicros.toString(), asOf: asOf.toISOString() },
      accounting: {
        accountedPrincipalUsdcMicrosBefore: accountedBefore.toString(),
        accountedPrincipalUsdcMicrosAfter: accountedBefore.toString(),
        deltaMicros: "0",
        deltaCents: 0,
      },
      result: { createdPaymentIntents: 0, paymentIntentIds: [], status: "NO_CHANGE" },
    });
  }

  const idempotencyKey = `funding_refresh_${userId}_${accountedBefore}_${balanceMicros}`;
  let pi: any = null;
  try {
    pi = await createDepositIntentAndLedger({
      userId,
      amountCents: maxCents,
      idempotencyKey,
      metadata: { source: "funding", fundingWalletAddress: uw.address },
    });
  } catch (e: any) {
    if (e?.code === "P2002" || e?.message?.includes("Unique constraint")) {
      await updateRefreshMeta();
      return reply.send({
        userId,
        wallet: { chain: uw.chain, address: uw.address },
        observed: { walletUsdcBalanceMicros: balanceMicros.toString(), asOf: asOf.toISOString() },
        accounting: {
          accountedPrincipalUsdcMicrosBefore: accountedBefore.toString(),
          accountedPrincipalUsdcMicrosAfter: accountedBefore.toString(),
          deltaMicros: deltaMicros.toString(),
          deltaCents,
        },
        result: { createdPaymentIntents: 0, paymentIntentIds: [], status: "NO_CHANGE" },
      });
    }
    throw e;
  }

  const userStashId = await getUserStashAccountId(userId);
  const pendingDepositId = await getSystemAccountId(AccountType.PENDING_DEPOSIT);
  const settleIdempo = `settle_${pi.id}`;
  const accountedAfter = accountedBefore + BigInt(pi.amountCents) * 10_000n;
  await prisma.$transaction(async (tx) => {
    const existingJE = await tx.journalEntry.findUnique({ where: { idempotencyKey: settleIdempo } });
    let jeId: string;
    if (!existingJE) {
      const je = await tx.journalEntry.create({
        data: {
          idempotencyKey: settleIdempo,
          type: EntryType.DEPOSIT_SETTLED,
          metadata: { paymentIntentId: pi.id, provider: "coinbase_funding", providerRef: "onramp" },
          lines: {
            create: [
              { accountId: userStashId, amountCents: pi.amountCents, memo: "Deposit settled" },
              { accountId: pendingDepositId, amountCents: -pi.amountCents, memo: "Release pending" },
            ],
          },
        },
      });
      jeId = je.id;
    } else {
      jeId = existingJE.id;
    }
    await tx.paymentIntent.update({
      where: { id: pi.id },
      data: { status: "SETTLED", provider: "coinbase_funding", providerRef: "onramp", settledEntryId: jeId },
    });
    await tx.userWallet.update({
      where: { userId },
      data: {
        accountedPrincipalUsdcMicros: accountedAfter.toString(),
        lastFundingRefreshAt: asOf,
        lastObservedBalanceMicros: balanceMicros.toString(),
      },
    });
  });

  return reply.send({
    userId,
    wallet: { chain: uw.chain, address: uw.address },
    observed: { walletUsdcBalanceMicros: balanceMicros.toString(), asOf: asOf.toISOString() },
    accounting: {
      accountedPrincipalUsdcMicrosBefore: accountedBefore.toString(),
      accountedPrincipalUsdcMicrosAfter: accountedAfter.toString(),
      deltaMicros: deltaMicros.toString(),
      deltaCents,
    },
    result: {
      createdPaymentIntents: 1,
      paymentIntentIds: [pi.id],
      status: "SETTLED",
    },
  });
});

// --- Wallet provision (WalletProvider abstraction; default = deterministic dev) ---
const walletProvider = deterministicWalletProvider;

app.post("/users/:userId/wallet/provision", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const existing = await prisma.userWallet.findUnique({ where: { userId } });
  if (existing) {
    return reply.send({
      ok: true,
      wallet: {
        address: existing.address,
        walletType: existing.walletType,
        chain: existing.chain,
        providerRef: existing.providerRef ?? undefined,
      },
    });
  }
  const { address, providerRef } = await walletProvider.createSmartWallet(userId);
  await prisma.userWallet.create({
    data: {
      userId,
      address,
      walletType: "SMART",
      chain: "base",
      providerRef: providerRef ?? undefined,
    },
  });
  return reply.send({
    ok: true,
    wallet: { address, walletType: "SMART", chain: "base", providerRef: providerRef ?? undefined },
  });
});

const UpdateChallengeSettingsSchema = z.object({
  scaleOverride: z.number().int().optional(),
});

app.patch(
  "/users/:userId/challenges/:userChallengeId/settings",
  { preHandler: [requireAuth, requireUserIdMatch] },
  async (req, reply) => {
    const userId = (req.params as any).userId as string;
    const userChallengeId = (req.params as any).userChallengeId as string;
    const parsed = UpdateChallengeSettingsSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.flatten() });

    const uc = await prisma.userChallenge.findUnique({
      where: { id: userChallengeId },
      include: { template: true },
    });
    if (!uc || uc.userId !== userId)
      return reply.code(404).send({ error: "Challenge not found" });

    const rules = (uc.rules as any) ?? (uc.template as any)?.defaultRules ?? {};
    const amount = rules.amount ?? {};
    if (rules.type !== "temperature") {
      return reply.code(400).send({ error: "Scale override not supported" });
    }

    const nextSettings = { ...(uc.settings as any) };
    if (parsed.data.scaleOverride !== undefined) {
      const v = parsed.data.scaleOverride;
      if (v !== 1 && v !== 10) {
        return reply.code(400).send({ error: "scaleOverride must be 1 or 10" });
      }
      nextSettings.scaleOverride = v;
    }

    const updated = await prisma.userChallenge.update({
      where: { id: uc.id },
      data: { settings: nextSettings },
    });

    const override = Number((updated.settings as any)?.scaleOverride);
    const effectiveScale =
      override === 1 || override === 10 ? override : Number(amount.scale ?? 1);

    return reply.send({
      ok: true,
      userChallengeId: updated.id,
      settings: updated.settings,
      effectiveScale,
    });
  },
);

const StartChallengeSchema = z.object({
  userId: z.string().uuid(),
  templateSlug: z.string(),
  startDate: z.string().datetime().optional(), // default now
  name: z.string().optional(),
  settings: z.record(z.any()).optional(),
  ruleOverrides: z.record(z.any()).optional(), // POWER: e.g. { amount: { sides: 12, multiDice: 2 } }
});

function computeNextWeeklyRun(start: Date, weekday: number) {
  // returns next occurrence of given weekday at 09:00 local-ish (weâ€™ll keep UTC for now)
  const d = new Date(start);
  d.setUTCHours(9, 0, 0, 0);

  const currentWeekday = d.getUTCDay();
  const delta = (weekday - currentWeekday + 7) % 7;
  if (delta === 0) return d; // today at 9
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

app.post("/challenges/start", { preHandler: [requireAuth] }, async (req, reply) => {
  const parsed = StartChallengeSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const { userId, templateSlug } = parsed.data;
  if ((req as any).user?.id !== userId) {
    return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
  }
  if (!checkRateLimit(`user:${userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }

  const primeToday = ((req.query as any)?.primeToday ?? "false").toString() === "true";
  const startDate = parsed.data.startDate
    ? new Date(parsed.data.startDate)
    : new Date();

  const template = await prisma.challengeTemplate.findUnique({
    where: { slug: templateSlug },
  });
  if (!template) return reply.code(404).send({ error: "Template not found" });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true },
  });
  const tier = (user?.tier as string) ?? "NORMIE";
  const isPowerOrDev = tier === "POWER" || tier === "DEV";

  let rules = { ...(template.defaultRules as any) };
  const overrides = (parsed.data.ruleOverrides ?? {}) as Record<string, any>;
  if (Object.keys(overrides).length > 0) {
    if (!isPowerOrDev) {
      return reply.code(403).send({ error: "Rule overrides are only available on POWER tier" });
    }
    if (overrides.amount && (rules.type === "dice" || templateSlug === "dice_daily" || templateSlug === "dice")) {
      const allowedSides = [6, 12, 20, 100];
      const sides = Number(overrides.amount.sides ?? rules.amount?.sides ?? rules.sides ?? 6);
      if (!allowedSides.includes(sides)) overrides.amount.sides = 6;
      if (overrides.amount.multiDice >= 2 && overrides.amount.multiplier >= 10) {
        delete overrides.amount.multiplier;
      }
      rules.amount = { ...(rules.amount ?? {}), ...overrides.amount };
    }
    if ((templateSlug === "100_envelopes" || rules.type === "envelopes") && overrides) {
      if (typeof overrides.maxDrawsPerDay === "number" && overrides.maxDrawsPerDay <= 2)
        rules.maxDrawsPerDay = overrides.maxDrawsPerDay;
      if (overrides.cadence === "weekly") rules.cadence = "weekly";
      if (overrides.order === "reverse") rules.order = "reverse";
    }
    if (overrides.schedule) rules.schedule = { ...(rules.schedule ?? {}), ...overrides.schedule };
  }
  const autoCommitDefault = rules.autoCommitDefault ?? true;
  const schedule = rules.schedule ?? {};
  const catchUpDefault = schedule.catchUp ?? true;
  const maxCatchUpEventsDefault = schedule.maxCatchUpEvents ?? 30;
  let nextRunAt: Date | null = null;
  let state: any = null;

    if (rules.type === "weekly_increment") {
      nextRunAt = computeNextWeeklyRun(startDate, rules.weekday ?? 1);
    } else if (rules.type === "weather_wednesday") {
    const schedule = rules.schedule ?? {};
    const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : ["WED"];
    const weekday = dayOfWeekToNumber(days[0] ?? "WED");
    nextRunAt = computeNextWeeklyRun(startDate, weekday);
  } else if (rules.type === "envelopes") {
    const min = rules.min ?? 1;
    const max = rules.max ?? 100;
    const reverse = rules.order === "reverse";
    const pool = Array.from(
      { length: max - min + 1 },
      (_, i) => (reverse ? max - i : min + i),
    );
    state = {
      remaining: pool,
      used: [],
    };
  }

  const settingsOverride = (parsed.data.settings ?? {}) as Record<string, any>;
  const mergedSettings = {
    autoCommit: autoCommitDefault,
    catchUp: catchUpDefault,
    maxCatchUpEvents: maxCatchUpEventsDefault,
    ...settingsOverride,
  };

  const uc = await prisma.userChallenge.create({
    data: {
      userId,
      templateId: template.id,
      name: parsed.data.name ?? template.name,
      startDate,
      rules: rules,
      settings: mergedSettings,
      nextRunAt,
      state,
      status: "ACTIVE",
    } as any,
  });

  let primed: any = null;
  if (primeToday) {
    try {
      primed = await primeSingleChallengeDue(uc, new Date());
    } catch (e: any) {
      primed = { error: e?.message ?? "prime_failed" };
    }
  }

  return {
    ok: true,
    userChallengeId: uc.id,
    nextRunAt,
    state,
    primed,
    primedEventId: primed?.eventId ?? null,
    templateSlug,
  };
});

app.post("/challenges/run-due", async () => {
  const now = new Date();
  console.log(`[SCHEDULER] Checking due at ${now.toISOString()}`);

  const due = await prisma.userChallenge.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { lte: now },
    },
    include: { template: true },
  });
  console.log(`[SCHEDULER] Found ${due.length} due challenges`);

  let processed = 0;

  for (const uc of due) {
    const rules = uc.rules as any;

    // compute "week number" since start (1-based)
    const weeksSinceStart =
      Math.floor(
        (now.getTime() - uc.startDate.getTime()) / (7 * 24 * 3600 * 1000),
      ) + 1;
    if (weeksSinceStart > (rules.maxWeeks ?? 52)) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED", nextRunAt: null },
      });
      continue;
    }

    const amountCents =
      (rules.week1AmountCents ?? 100) +
      (weeksSinceStart - 1) * (rules.incrementCents ?? 100);
    const scheduledFor = uc.nextRunAt ?? now;

    const eventIdempo = `ch_${uc.id}_${scheduledFor.toISOString()}`;

    // create event idempotently
    const existingEvent = await prisma.challengeEvent.findUnique({
      where: { idempotencyKey: eventIdempo },
    });
    if (existingEvent) {
      // move schedule forward anyway (in case last run died after event creation)
    } else {
      const piIdempo = `dep_${eventIdempo}`;

      const pi = await createDepositIntentAndLedger({
        userId: uc.userId,
        amountCents,
        idempotencyKey: piIdempo,
        metadata: { challengeId: uc.id, weeksSinceStart },
      });

      await prisma.challengeEvent.create({
        data: {
          userChallengeId: uc.id,
          scheduledFor,
          idempotencyKey: `ce_${uc.id}_${scheduledFor.toISOString()}`,
          amountCents,
          result: "DEPOSIT_CREATED",
          paymentIntentId: pi.id,
          metadata: { weeksSinceStart } as any,
        } as any,
      });
    }

    // Advance nextRunAt to next week same weekday 9:00 UTC
    const next = new Date(scheduledFor);
    next.setUTCDate(next.getUTCDate() + 7);

    await prisma.userChallenge.update({
      where: { id: uc.id },
      data: { lastRunAt: scheduledFor, nextRunAt: next },
    });

    processed++;
  }

  return { ok: true, processed };
});

function startOfWeekUtc(d: Date): Date {
  const dayOnly = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const dayNum = dayOnly.getUTCDay();
  const mondayOffset = dayNum === 0 ? -6 : 1 - dayNum;
  return addDaysUtc(dayOnly, mondayOffset);
}

async function runDueForUserImpl(userId: string): Promise<any | null> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true },
  });
  if (!user) return null;

  const rawUserFlags = (user.flags as any) ?? {};
  const dailyCapOverride = rawUserFlags.dailyAutoSaveCapCents;
  const perRunCapOverride = rawUserFlags.perRunAutoSaveCapCents;

  const dailyCapCents =
    typeof dailyCapOverride === "number"
      ? dailyCapOverride
      : user.tier === "POWER" || user.tier === "DEV"
        ? 40_000
        : 5_000;
  const perRunCapCents = typeof perRunCapOverride === "number" ? perRunCapOverride : 20_000;
  const weeklyCapCents = user.tier === "POWER" || user.tier === "DEV" ? 100_000 : null;

  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = startOfWeekUtc(now);
  const weekEnd = addDaysUtc(weekStart, 7);

  const [todayUsedAgg, weekUsedAgg] = await Promise.all([
    prisma.paymentIntent.aggregate({
      where: {
        userId,
        type: "DEPOSIT",
        status: "SETTLED",
        createdAt: { gte: dayStart, lt: dayEnd },
        metadata: { path: ["source"], equals: "challenge" },
      },
      _sum: { amountCents: true },
    }),
    weeklyCapCents != null
      ? prisma.paymentIntent.aggregate({
          where: {
            userId,
            type: "DEPOSIT",
            status: "SETTLED",
            createdAt: { gte: weekStart, lt: weekEnd },
            metadata: { path: ["source"], equals: "challenge" },
          },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 as number | null } }),
  ]);
  const todayUsedStartCents = todayUsedAgg._sum.amountCents ?? 0;
  const weekUsedStartCents = weekUsedAgg._sum.amountCents ?? 0;
  let usedCents = todayUsedStartCents;
  let runCommittedCents = 0;
  let weekCommittedCents = weekUsedStartCents;

  const skippedCap: Array<{
    eventId: string;
    userChallengeId: string;
    amountCents: number;
    reason: "daily_cap" | "per_run_cap" | "weekly_cap";
  }> = [];

  const ucs = await prisma.userChallenge.findMany({
    where: { userId, status: "ACTIVE" },
    include: { template: true },
    orderBy: { createdAt: "asc" },
  });

  const results: any[] = [];

  for (const uc of ucs) {
    const rules = (uc.rules as any) ?? {};
    if (
      rules.type !== "weekly_increment" &&
      rules.type !== "weather_wednesday" &&
      rules.type !== "temperature" &&
      rules.type !== "dice"
    )
      continue;

    const schedule = rules.schedule ?? {};
    const settings = (uc.settings as any) ?? {};

    const catchUp = settings.catchUp ?? schedule.catchUp ?? true;
    const maxCatchUpEvents = Math.max(
      0,
      Number(settings.maxCatchUpEvents ?? schedule.maxCatchUpEvents ?? 30),
    );
    const autoCommit = settings.autoCommit !== false;

    const allowed = catchUp ? maxCatchUpEvents : Math.min(1, maxCatchUpEvents || 1);

    const isWeekdaySchedule = schedule.type === "weekday";
    const isDailySchedule = schedule.type === "daily";
    const scheduleDays = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
    const scheduleDayNums = isDailySchedule
      ? [0, 1, 2, 3, 4, 5, 6]
      : scheduleDays.map(dayOfWeekToNumber);

    const weeklyWeekday =
      typeof schedule.dayOfWeek === "string"
        ? dayOfWeekToNumber(schedule.dayOfWeek)
        : Number(rules.weekday ?? 1);

    const firstRun = computeNextWeeklyRun(
      uc.startDate,
      isWeekdaySchedule && scheduleDayNums.length > 0 ? scheduleDayNums[0] : weeklyWeekday,
    );
    const startCursor = uc.lastRunAt
      ? new Date(
          new Date(uc.lastRunAt).getTime() +
            ((isWeekdaySchedule || isDailySchedule) ? 24 : 7) * 3600 * 1000,
        )
      : firstRun;

    let cursor = startCursor;
    let createdEvents = 0;
    let committedEvents = 0;
    let skippedExisting = 0;
    let alreadyCommitted = 0;
    let skippedCapCount = 0;
    let lastScheduled: Date | null = null;

    const isPowerOrDev = user.tier === "POWER" || user.tier === "DEV";
    const existingMakeup = isPowerOrDev
      ? await prisma.challengeEvent.findFirst({
          where: { userChallengeId: uc.id, metadata: { path: ["makeup"], equals: true } },
        })
      : null;
    let makeupCreatedForThisUc = !!existingMakeup;

    const processEvent = async (scheduledAt: Date) => {
      const dayKey = yyyymmddUtc(scheduledAt);
      const eventIdempo = `sched_${uc.id}_${dayKey}`;
      const isPastDay = scheduledAt < dayStart;

      const existing = await prisma.challengeEvent.findUnique({
        where: { idempotencyKey: eventIdempo },
      });

      let evId: string;
      let amountCents: number | null | undefined;
      if (existing) {
        skippedExisting += 1;
        evId = existing.id;
        amountCents = existing.amountCents;
      } else {
        if (isPastDay && isPowerOrDev && makeupCreatedForThisUc) return;

        const weekIndex =
          Math.floor((scheduledAt.getTime() - firstRun.getTime()) / (7 * 24 * 3600 * 1000)) + 1;

        const dayLabel = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
          scheduledAt.getUTCDay()
        ];

        let metadata: any;
        if (rules.type === "weekly_increment") {
          amountCents =
            (rules.week1AmountCents ?? 100) + (weekIndex - 1) * (rules.incrementCents ?? 100);
          metadata = { weeksSinceStart: weekIndex };
        } else if (rules.type === "weather_wednesday") {
          const amtRules = rules.amount ?? {};
          amountCents = autoCommit
            ? Number(amtRules.defaultAmountCents ?? 700) > 0
              ? Number(amtRules.defaultAmountCents)
              : 700
            : null;
          metadata = { weekday: dayLabel, inputStatus: "NEEDS_INPUT" };
        } else if (rules.type === "dice") {
          if (isPastDay && isPowerOrDev && !makeupCreatedForThisUc) {
            const amountRules = rules.amount ?? {};
            const sides = Number(amountRules.sides ?? rules.sides ?? 6);
            const unitAmountCents = Number(amountRules.unitAmountCents ?? rules.unitAmountCents ?? 100);
            const roll = deterministicRoll({
              userId: uc.userId,
              eventId: eventIdempo,
              sides: [6, 12, 20, 100].includes(sides) ? sides : 6,
            });
            const rawCents = roll * unitAmountCents;
            const maxDice = 2000;
            amountCents = Math.min(rawCents, maxDice);
            metadata = { weekday: dayLabel, rollStatus: "NEEDS_ROLL", makeup: true, roll, sides };
            makeupCreatedForThisUc = true;
          } else {
            amountCents = null;
            metadata = { weekday: dayLabel, rollStatus: "NEEDS_ROLL" };
          }
        } else if (rules.type === "temperature") {
          amountCents = autoCommit
            ? Number((rules.amount ?? {}).defaultAmountCents ?? 700) || 700
            : null;
          metadata = { weekday: dayLabel, inputStatus: "NEEDS_INPUT" };
        } else {
          amountCents = null;
          metadata = { weekday: dayLabel, inputStatus: "NEEDS_INPUT" };
        }

        if (isPastDay && isPowerOrDev && rules.type === "weekly_increment" && !makeupCreatedForThisUc) {
          metadata = { ...metadata, makeup: true };
          makeupCreatedForThisUc = true;
        }
        if (isPastDay && isPowerOrDev && (rules.type === "weather_wednesday" || rules.type === "temperature") && !makeupCreatedForThisUc) {
          if (amountCents == null) amountCents = Number((rules.amount ?? {}).defaultAmountCents ?? 700) || 700;
          metadata = { ...metadata, makeup: true };
          makeupCreatedForThisUc = true;
        }

        const created = await prisma.challengeEvent.create({
          data: {
            userChallengeId: uc.id,
            scheduledFor: scheduledAt,
            idempotencyKey: eventIdempo,
            amountCents,
            result: "DEPOSIT_SCHEDULED",
            metadata,
          } as any,
        });
        createdEvents += 1;
        evId = created.id;
      }

      if (autoCommit) {
        if (!amountCents || amountCents <= 0) {
          // skip auto-commit until user input provides a valid amount
          return;
        }
        // If already committed, don't re-run caps or attempt another commit.
        if (existing?.paymentIntentId) {
          alreadyCommitted += 1;
        } else {
          const nextUsed = usedCents + amountCents;
          const nextRun = runCommittedCents + amountCents;

          if (nextUsed > dailyCapCents) {
            skippedCap.push({
              eventId: evId,
              userChallengeId: uc.id,
              amountCents,
              reason: "daily_cap",
            });
            skippedCapCount += 1;
          } else if (nextRun > perRunCapCents) {
            skippedCap.push({
              eventId: evId,
              userChallengeId: uc.id,
              amountCents,
              reason: "per_run_cap",
            });
            skippedCapCount += 1;
          } else if (weeklyCapCents != null && weekCommittedCents + amountCents > weeklyCapCents) {
            skippedCap.push({
              eventId: evId,
              userChallengeId: uc.id,
              amountCents,
              reason: "weekly_cap",
            });
            skippedCapCount += 1;
          } else {
            const res = await commitChallengeEvent({
              userId: uc.userId,
              userChallengeId: uc.id,
              challengeEventId: evId,
            });

            if (res.status !== "ALREADY_COMMITTED") {
              committedEvents += 1;
              usedCents = nextUsed;
              runCommittedCents = nextRun;
              weekCommittedCents += amountCents;
            } else {
              alreadyCommitted += 1;
            }
          }
        }
      }

      lastScheduled = scheduledAt;
    };

    if (isWeekdaySchedule || isDailySchedule) {
      const nowDay = utcDateOnly(now);
      let scan = utcDateOnly(cursor);
      while (scan <= nowDay && createdEvents < allowed) {
        const dayNum = scan.getUTCDay();
        if (scheduleDayNums.length === 0 || scheduleDayNums.includes(dayNum)) {
          await processEvent(scan);
        }
        scan = addDaysUtc(scan, 1);
      }
      cursor = scan;
    } else {
      for (let i = 0; i < allowed && cursor <= now; i++) {
        await processEvent(cursor);
        cursor = addDaysUtc(cursor, 7);
      }
    }

    // Update scheduler pointers (best-effort, idempotent-ish)
    if (lastScheduled) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: {
          lastRunAt: lastScheduled,
          nextRunAt: new Date(
            lastScheduled.getTime() +
              ((isWeekdaySchedule || isDailySchedule) ? 24 : 7) * 24 * 3600 * 1000,
          ),
        },
      });
    } else if (!uc.lastRunAt) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { nextRunAt: firstRun },
      });
    }

    results.push({
      userChallengeId: uc.id,
      templateSlug: uc.template?.slug ?? null,
      createdEvents,
      committedEvents,
      skippedExisting,
      alreadyCommitted,
      skippedCap: skippedCapCount,
      lastRunAt: lastScheduled ?? uc.lastRunAt ?? null,
    });
  }

  return {
    ok: true,
    userId,
    now: now.toISOString(),
    caps: {
      dailyCapCents,
      perRunCapCents,
      todayUsedCents: todayUsedStartCents,
      todayUsedCentsAfter: usedCents,
      runCommittedCents,
    },
    skippedCap,
    results,
  };
}

async function runDueForUser(userId: string): Promise<any | null> {
  const existing = runDueLocks.get(userId);
  if (existing) return existing;
  const promise = runDueForUserImpl(userId);
  runDueLocks.set(userId, promise);
  try {
    return await promise;
  } finally {
    runDueLocks.delete(userId);
  }
}

app.post("/users/:userId/challenges/run-due", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  const r = await runDueForUser(userId);
  if (!r) return reply.code(404).send({ error: "User not found" });
  return reply.send(r);
});

app.post("/users/:userId/challenges/commit-pending", { preHandler: [requireAuth, requireUserIdMatch] }, async (req, reply) => {
  const userId = (req.params as any).userId as string;
  if (!checkRateLimit(`user:${userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }
  const limit = Math.min(Math.max(Number((req.query as any)?.limit ?? 50), 1), 200);
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, flags: true },
  });
  if (!user) return reply.code(404).send({ error: "User not found" });

  const rawUserFlags = (user.flags as any) ?? {};
  const dailyCapOverride = rawUserFlags.dailyAutoSaveCapCents;
  const perRunCapOverride = rawUserFlags.perRunAutoSaveCapCents;

  const dailyCapCents =
    typeof dailyCapOverride === "number"
      ? dailyCapOverride
      : user.tier === "POWER" || user.tier === "DEV"
        ? 40_000
        : 5_000;
  const perRunCapCents = typeof perRunCapOverride === "number" ? perRunCapOverride : 20_000;
  const weeklyCapCents = user.tier === "POWER" || user.tier === "DEV" ? 100_000 : null;

  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = startOfWeekUtc(now);
  const weekEnd = addDaysUtc(weekStart, 7);

  const [todayUsedAgg, weekUsedAgg] = await Promise.all([
    prisma.paymentIntent.aggregate({
      where: {
        userId,
        type: "DEPOSIT",
        status: "SETTLED",
        createdAt: { gte: dayStart, lt: dayEnd },
        metadata: { path: ["source"], equals: "challenge" },
      },
      _sum: { amountCents: true },
    }),
    weeklyCapCents != null
      ? prisma.paymentIntent.aggregate({
          where: {
            userId,
            type: "DEPOSIT",
            status: "SETTLED",
            createdAt: { gte: weekStart, lt: weekEnd },
            metadata: { path: ["source"], equals: "challenge" },
          },
          _sum: { amountCents: true },
        })
      : Promise.resolve({ _sum: { amountCents: 0 as number | null } }),
  ]);
  const todayUsedStartCents = todayUsedAgg._sum.amountCents ?? 0;
  const weekUsedStartCents = weekUsedAgg._sum.amountCents ?? 0;
  let usedCents = todayUsedStartCents;
  let runCommittedCents = 0;
  let weekCommittedCents = weekUsedStartCents;

  const pending = await prisma.challengeEvent.findMany({
    where: {
      paymentIntentId: null,
      userChallenge: { userId, status: "ACTIVE" },
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  const skippedCap: Array<{
    eventId: string;
    userChallengeId: string;
    amountCents: number;
    reason: "daily_cap" | "per_run_cap" | "weekly_cap";
  }> = [];

  let committedCount = 0;
  let committedCents = 0;
  let skippedCapCents = 0;
  let perRunCapHit = false;

  for (const ev of pending) {
    const amountCents = ev.amountCents;
    if (!amountCents || amountCents <= 0) continue;

    const nextUsed = usedCents + amountCents;
    const nextRun = runCommittedCents + amountCents;
    const nextWeek = weekCommittedCents + amountCents;

    if (nextUsed > dailyCapCents) {
      skippedCap.push({
        eventId: ev.id,
        userChallengeId: ev.userChallengeId,
        amountCents,
        reason: "daily_cap",
      });
      skippedCapCents += amountCents;
      continue;
    }

    if (nextRun > perRunCapCents) {
      skippedCap.push({
        eventId: ev.id,
        userChallengeId: ev.userChallengeId,
        amountCents,
        reason: "per_run_cap",
      });
      skippedCapCents += amountCents;
      perRunCapHit = true;
      break;
    }

    if (weeklyCapCents != null && nextWeek > weeklyCapCents) {
      skippedCap.push({
        eventId: ev.id,
        userChallengeId: ev.userChallengeId,
        amountCents,
        reason: "weekly_cap",
      });
      skippedCapCents += amountCents;
      continue;
    }

    const res = await commitChallengeEvent({
      userId,
      userChallengeId: ev.userChallengeId,
      challengeEventId: ev.id,
    });

    // commitChallengeEvent is idempotent; only count new commits
    if (res.status !== "ALREADY_COMMITTED") {
      committedCount += 1;
      committedCents += amountCents;
      usedCents = nextUsed;
      runCommittedCents = nextRun;
      weekCommittedCents += amountCents;
    }
  }

  return reply.send({
    ok: true,
    userId,
    scanned: pending.length,
    committedCount,
    committedCents,
    skippedCapCount: skippedCap.length,
    skippedCapCents,
    perRunCapHit,
    skippedCap,
    caps: {
      dailyCapCents,
      perRunCapCents,
      todayUsedCents: todayUsedStartCents,
      todayUsedCentsAfter: usedCents,
      runCommittedCents,
    },
  });
});

app.post("/challenges/:id/draw", { preHandler: [requireAuth] }, async (req, reply) => {
  const challengeId = (req.params as any).id;

  const uc = await prisma.userChallenge.findUnique({
    where: { id: challengeId },
  });
  if (!uc || uc.status !== "ACTIVE") {
    return reply.code(400).send({ error: "Invalid or inactive challenge" });
  }
  if ((req as any).user?.id !== uc.userId) {
    return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
  }
  if (!checkRateLimit(`user:${uc.userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }

  const rules = uc.rules as any;
  const settings = (uc.settings as any) ?? {};
  const state = (uc as any).state as any;

  if (rules.type !== "envelopes") {
    return reply.code(400).send({ error: "Not an envelope challenge" });
  }

  if (!state || state.remaining.length === 0) {
    if (uc.status !== "COMPLETED") {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED" },
      });
    }
    return { done: true };
  }

  const now = new Date();
  const cadence = rules.cadence ?? "daily";
  const maxDrawsPerDay = Number(rules.maxDrawsPerDay ?? settings.maxDrawsPerDay ?? 1);

  if (cadence === "weekly") {
    const weekStart = startOfWeekUtc(now);
    const weekEnd = addDaysUtc(weekStart, 7);
    const drawsThisWeek = await prisma.challengeEvent.count({
      where: {
        userChallengeId: uc.id,
        createdAt: { gte: weekStart, lt: weekEnd },
      },
    });
    if (drawsThisWeek >= 1) {
      const nextAllowedAt = weekEnd;
      const retryAfterSeconds = Math.max(
        0,
        Math.floor((nextAllowedAt.getTime() - now.getTime()) / 1000),
      );
      return reply.code(429).send({
        error: "weekly_limit",
        retryAfterSeconds,
        nextAllowedAt: nextAllowedAt.toISOString(),
      });
    }
  } else {
    const startOfDayUTC = utcDateOnly(now);
    const startOfNextDayUTC = addDaysUtc(startOfDayUTC, 1);
    const drawsToday = await prisma.challengeEvent.count({
      where: {
        userChallengeId: uc.id,
        createdAt: { gte: startOfDayUTC, lt: startOfNextDayUTC },
      },
    });
    if (drawsToday >= maxDrawsPerDay) {
      const nextAllowedAt = startOfNextDayUTC;
      const retryAfterSeconds = Math.max(
        0,
        Math.floor((nextAllowedAt.getTime() - now.getTime()) / 1000),
      );
      return reply.code(429).send({
        error: "daily_limit",
        retryAfterSeconds,
        nextAllowedAt: nextAllowedAt.toISOString(),
      });
    }
  }

  // Draw random
  const index = Math.floor(Math.random() * state.remaining.length);
  const envelope = state.remaining[index];
  const amountCents = envelope * (rules.unitAmountCents ?? 100);

  const eventIdempo = `env_${uc.id}_${envelope}`;

  // Idempotency check
  const existing = await prisma.challengeEvent.findUnique({
    where: { idempotencyKey: eventIdempo },
  });
  if (existing) {
    const envMeta = (existing.metadata as any) ?? {};
    let committedPi = existing.paymentIntentId;
    if (!committedPi && (uc.settings as any)?.autoCommit !== false) {
      const res = await commitChallengeEvent({
        userId: uc.userId,
        userChallengeId: uc.id,
        challengeEventId: existing.id,
      });
      committedPi = res.paymentIntentId;
    }
    return {
      envelope: envMeta.envelope ?? envelope,
      amountCents: existing.amountCents,
      remainingCount: state.remaining.length,
      paymentIntentId: committedPi,
    };
  }

  try {
    const pi = await createDepositIntentAndLedger({
      userId: uc.userId,
      amountCents,
      idempotencyKey: `dep_${eventIdempo}`,
      metadata: { challengeId: uc.id, envelope },
    });

    state.remaining.splice(index, 1);
    state.used.push(envelope);

    const ce = await prisma.$transaction(async (tx) => {
      const created = await tx.challengeEvent.create({
        data: {
          userChallengeId: uc.id,
          scheduledFor: new Date(),
          idempotencyKey: eventIdempo,
          amountCents,
          result: "DEPOSIT_CREATED",
          paymentIntentId: pi.id,
          metadata: { envelope } as any,
        } as any,
      });
      await tx.userChallenge.update({
        where: { id: uc.id },
        data: { state } as any,
      });
      return created;
    });

    // Check if that was the last one
    if (state.remaining.length === 0) {
      await prisma.userChallenge.update({
        where: { id: uc.id },
        data: { status: "COMPLETED" },
      });
    }

    let committedPi = pi.id;
    if (settings.autoCommit !== false) {
      const res = await commitChallengeEvent({
        userId: uc.userId,
        userChallengeId: uc.id,
        challengeEventId: (ce as any).id,
      });
      committedPi = res.paymentIntentId;
    }

    return {
      envelope,
      amountCents,
      remainingCount: state.remaining.length,
      paymentIntentId: committedPi,
    };
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

app.post("/challenges/:id/roll", { preHandler: [requireAuth] }, async (req, reply) => {
  const challengeId = (req.params as any).id;

  const uc = await prisma.userChallenge.findUnique({
    where: { id: challengeId },
  });
  if (!uc || uc.status !== "ACTIVE") {
    return reply.code(400).send({ error: "Invalid or inactive challenge" });
  }
  if ((req as any).user?.id !== uc.userId) {
    return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
  }
  if (!checkRateLimit(`user:${uc.userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
    return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
  }

  const rules = uc.rules as any;
  const settings = (uc.settings as any) ?? {};
  if (rules.type !== "dice") {
    return reply.code(400).send({ error: "Not a dice challenge" });
  }

  const roll = Math.floor(Math.random() * (rules.sides ?? 6)) + 1;
  const amountCents = roll * (rules.unitAmountCents ?? 100);

  const eventIdempo = `dice_${uc.id}_${Date.now()}`; // Dice can be rolled many times

  try {
    const pi = await createDepositIntentAndLedger({
      userId: uc.userId,
      amountCents,
      idempotencyKey: `dep_${eventIdempo}`,
      metadata: { challengeId: uc.id, roll },
    });

    const event = await prisma.challengeEvent.create({
      data: {
        userChallengeId: uc.id,
        scheduledFor: new Date(),
        idempotencyKey: eventIdempo,
        amountCents,
        result: "DEPOSIT_CREATED",
        paymentIntentId: pi.id,
        metadata: { roll } as any,
      } as any,
    });

    let committedPi = pi.id;
    if (settings.autoCommit !== false) {
      const res = await commitChallengeEvent({
        userId: uc.userId,
        userChallengeId: uc.id,
        challengeEventId: (event as any).id,
      });
      committedPi = res.paymentIntentId;
    }

    return { roll, amountCents, eventId: (event as any).id, paymentIntentId: committedPi };
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

app.post("/challenges/:challengeId/events/:eventId/commit", { preHandler: [requireAuth] }, async (req, reply) => {
  const { challengeId, eventId } = req.params as any;

  try {
    const ce = await prisma.challengeEvent.findUnique({
      where: { id: eventId },
      include: { userChallenge: true },
    });
    if (!ce || ce.userChallengeId !== challengeId)
      return reply.code(404).send({ error: "Challenge event not found" });
    if ((req as any).user?.id !== ce.userChallenge!.userId) {
      return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
    }
    if (!checkRateLimit(`user:${ce.userChallenge!.userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
      return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
    }

    const res = await commitChallengeEvent({
      userId: ce.userChallenge!.userId,
      userChallengeId: challengeId,
      challengeEventId: eventId,
    });
    return { paymentIntentId: res.paymentIntentId, status: res.status, amountCents: ce.amountCents };
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

const SetWeatherSchema = z.object({
  choice: z.string().min(1),
});

const SetTemperatureSchema = z.object({
  mode: z.enum(["gps", "place", "manual"]),
  lat: z.number().optional(),
  lon: z.number().optional(),
  zip: z.string().optional(),
  query: z.string().optional(),
  temp: z.number().optional(),
  unit: z.enum(["F", "C"]).optional(),
});

app.post("/challenges/:challengeId/events/:eventId/set-weather", { preHandler: [requireAuth] }, async (req, reply) => {
  const { challengeId, eventId } = req.params as any;
  const parsed = SetWeatherSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const choice = parsed.data.choice.trim();

  try {
    const ce = await prisma.challengeEvent.findUnique({
      where: { id: eventId },
      include: { userChallenge: { include: { template: true } } },
    });
    if (!ce || ce.userChallengeId !== challengeId)
      return reply.code(404).send({ error: "Challenge event not found" });
    if ((req as any).user?.id !== ce.userChallenge!.userId) {
      return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
    }
    if (!checkRateLimit(`user:${ce.userChallenge!.userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
      return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
    }

    const uc = ce.userChallenge;
    const rules = (uc?.rules as any) ?? (uc?.template as any)?.defaultRules ?? {};
    if (rules.type !== "weather_wednesday") {
      return reply.code(400).send({ error: "Not a weather challenge" });
    }

    if (ce.paymentIntentId) {
      return reply.send({ status: "already_committed", paymentIntentId: ce.paymentIntentId });
    }

    const amountRules = rules.amount ?? {};
    const options = Array.isArray(amountRules.options) ? amountRules.options : [];
    const match =
      options.find((o: any) => String(o.choice ?? o.label).toLowerCase() === choice.toLowerCase()) ??
      (choice.toLowerCase() === "default"
        ? { choice: "Default", amountCents: amountRules.defaultAmountCents ?? 700 }
        : null);
    if (!match || typeof match.amountCents !== "number" || match.amountCents <= 0) {
      return reply.code(400).send({ error: "Invalid weather choice" });
    }

    const maxWeatherSaveCents = Number(amountRules.maxAmountCents ?? 2000);
    if (match.amountCents > maxWeatherSaveCents) {
      return reply.code(400).send({
        error: "Weather amount exceeds limit",
        maxAmountCents: maxWeatherSaveCents,
      });
    }

    await prisma.challengeEvent.update({
      where: { id: ce.id },
      data: {
        amountCents: match.amountCents,
        metadata: { ...(ce.metadata as any), weather: match.choice ?? match.label },
      },
    });

    const res = await commitChallengeEvent({
      userId: uc!.userId,
      userChallengeId: challengeId,
      challengeEventId: ce.id,
    });

    return reply.send({
      status: res.status,
      paymentIntentId: res.paymentIntentId,
      amountCents: match.amountCents,
    });
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

app.post("/challenges/:challengeId/events/:eventId/set-temperature", { preHandler: [requireAuth] }, async (req, reply) => {
  const { challengeId, eventId } = req.params as any;
  const parsed = SetTemperatureSchema.safeParse(req.body);
  if (!parsed.success)
    return reply.code(400).send({ error: parsed.error.flatten() });

  const payload = parsed.data;
  const unit = payload.unit ?? "F";

  try {
    const ce = await prisma.challengeEvent.findUnique({
      where: { id: eventId },
      include: { userChallenge: { include: { template: true } } },
    });
    if (!ce || ce.userChallengeId !== challengeId)
      return reply.code(404).send({ error: "Challenge event not found" });
    if ((req as any).user?.id !== ce.userChallenge!.userId) {
      return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
    }
    if (!checkRateLimit(`user:${ce.userChallenge!.userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
      return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
    }

    const uc = ce.userChallenge;
    const rules = (uc?.rules as any) ?? (uc?.template as any)?.defaultRules ?? {};
    if (rules.type !== "weather_wednesday") {
      return reply.code(400).send({ error: "Not a weather challenge" });
    }

    if (ce.paymentIntentId) {
      return reply.send({ status: "already_committed", paymentIntentId: ce.paymentIntentId });
    }

    let tempF: number;
    let provider = "manual";
    let locationMode = payload.mode;

    if (payload.mode === "manual") {
      if (typeof payload.temp !== "number")
        return reply.code(400).send({ error: "Missing temp" });
      tempF = toTempF(payload.temp, unit);
    } else if (payload.mode === "gps") {
      if (typeof payload.lat !== "number" || typeof payload.lon !== "number") {
        return reply.code(400).send({ error: "Missing lat/lon" });
      }
      const dateKey = yyyymmddUtc(ce.scheduledFor ?? new Date());
      const res = await getTemperatureForDate({
        dateKey,
        lat: payload.lat,
        lon: payload.lon,
      });
      tempF = res.tempF;
      provider = res.provider;
    } else {
      if (!payload.zip && !payload.query) {
        return reply.code(400).send({ error: "Missing zip or query" });
      }
      const loc = await resolveOpenWeatherLatLon({ zip: payload.zip, query: payload.query });
      const dateKey = yyyymmddUtc(ce.scheduledFor ?? new Date());
      const res = await getTemperatureForDate({
        dateKey,
        lat: loc.lat,
        lon: loc.lon,
      });
      tempF = res.tempF;
      provider = res.provider;
      locationMode = "place";
    }

    const amountRules = rules.amount ?? {};
    const settings = (uc?.settings as any) ?? {};
    const scaleOverride = Number(settings.scaleOverride);
    const effectiveScale =
      scaleOverride === 1 || scaleOverride === 10
        ? scaleOverride
        : Number(amountRules.scale ?? 1);

    const user = await prisma.user.findUnique({
      where: { id: uc!.userId },
      select: { tier: true, flags: true },
    });
    const rawFlags = (user?.flags as any) ?? {};
    const tierMax =
      typeof rawFlags.maxSingleTempSaveCents === "number"
        ? rawFlags.maxSingleTempSaveCents
        : user?.tier === "DEV"
          ? 50_000
          : user?.tier === "POWER"
            ? 20_000
            : 5_000;

    const maxWeatherSaveCents = Math.min(
      Number(amountRules.maxAmountCents ?? 2000),
      tierMax,
    );
    const roundedTempF = Math.round(tempF);
    const rawCents = Math.round((roundedTempF / (effectiveScale > 0 ? effectiveScale : 1)) * 100);
    const amountCents = clampNumber(rawCents, 0, maxWeatherSaveCents);
    if (amountCents <= 0) {
      return reply.code(400).send({ error: "Temperature amount must be positive" });
    }

    await prisma.challengeEvent.update({
      where: { id: ce.id },
      data: {
        amountCents,
        metadata: {
          ...(ce.metadata as any),
          tempF: roundedTempF,
          provider,
          locationMode,
        },
      },
    });

    const res = await commitChallengeEvent({
      userId: uc!.userId,
      userChallengeId: challengeId,
      challengeEventId: ce.id,
    });

    return reply.send({
      status: res.status,
      paymentIntentId: res.paymentIntentId,
      amountCents,
      tempF: roundedTempF,
      provider,
    });
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

app.post("/challenges/:challengeId/events/:eventId/roll", { preHandler: [requireAuth] }, async (req, reply) => {
  const { challengeId, eventId } = req.params as any;

  try {
    const ce = await prisma.challengeEvent.findUnique({
      where: { id: eventId },
      include: { userChallenge: { include: { template: true } } },
    });
    if (!ce || ce.userChallengeId !== challengeId)
      return reply.code(404).send({ error: "Challenge event not found" });
    if ((req as any).user?.id !== ce.userChallenge!.userId) {
      return reply.code(403).send({ error: "forbidden", message: "User id does not match session" });
    }
    if (!checkRateLimit(`user:${ce.userChallenge!.userId}`, rateLimitUser, RATE_LIMIT_USER_ACTIONS)) {
      return reply.code(429).header("Retry-After", "60").send({ error: "rate_limit", retryAfterSeconds: 60 });
    }

    const uc = ce.userChallenge;
    const rules = (uc?.rules as any) ?? (uc?.template as any)?.defaultRules ?? {};
    if (rules.type !== "dice") {
      return reply.code(400).send({ error: "Not a dice challenge" });
    }

    if (ce.paymentIntentId) {
      return reply.send({ status: "already_committed", paymentIntentId: ce.paymentIntentId });
    }

    const amountRules = rules.amount ?? {};
    const sides = Number(amountRules.sides ?? rules.sides ?? 6);
    const unitAmountCents = Number(amountRules.unitAmountCents ?? rules.unitAmountCents ?? 100);
    const multiDice = Number(amountRules.multiDice ?? 1);
    const multiplier = Number(amountRules.multiplier ?? 1);
    if (!Number.isFinite(sides) || sides <= 1) {
      return reply.code(400).send({ error: "Invalid sides" });
    }
    if (!Number.isFinite(unitAmountCents) || unitAmountCents <= 0) {
      return reply.code(400).send({ error: "Invalid unitAmountCents" });
    }

    const user = await prisma.user.findUnique({
      where: { id: uc!.userId },
      select: { tier: true, flags: true },
    });
    const tier = (user?.tier as string) ?? "NORMIE";
    const isPowerOrDev = tier === "POWER" || tier === "DEV";

    const allowedSides = isPowerOrDev ? [6, 12, 20, 100] : [6];
    if (!allowedSides.includes(sides)) {
      return reply.code(400).send({ error: "This dice type is only available on POWER tier" });
    }
    if (multiDice > 1 && multiplier > 1) {
      return reply.code(400).send({ error: "Cannot use multi-dice and multiplier together" });
    }
    if (multiDice > 1 && !isPowerOrDev) {
      return reply.code(400).send({ error: "Multi-dice is only available on POWER tier" });
    }
    if (multiplier > 1 && !isPowerOrDev) {
      return reply.code(400).send({ error: "Dice multiplier is only available on POWER tier" });
    }

    const rawFlags = (user?.flags as any) ?? {};
    const tierMax =
      typeof rawFlags.maxSingleDiceSaveCents === "number"
        ? rawFlags.maxSingleDiceSaveCents
        : tier === "DEV"
          ? 50_000
          : tier === "POWER"
            ? 20_000
            : 5_000;

    const maxDiceSaveCents = Math.min(
      Number(amountRules.maxAmountCents ?? 2000),
      tierMax,
    );

    const { roll, rollBreakdown } = resolveDiceRoll({
      userId: uc!.userId,
      eventId: ce.id,
      sides,
      multiDice: multiDice >= 2 ? 2 : 1,
    });
    let rawCents = roll * unitAmountCents * (multiplier >= 10 ? 10 : 1);
    const amountCents = clampNumber(rawCents, 0, maxDiceSaveCents);
    if (amountCents <= 0) {
      return reply.code(400).send({ error: "Dice amount must be positive" });
    }

    const meta: Record<string, unknown> = {
      ...(ce.metadata as any),
      roll,
      sides,
      unitAmountCents,
    };
    if (rollBreakdown) meta.rollBreakdown = rollBreakdown;
    if (multiplier >= 10) meta.multiplier = 10;

    await prisma.challengeEvent.update({
      where: { id: ce.id },
      data: { amountCents, metadata: meta },
    });

    const res = await commitChallengeEvent({
      userId: uc!.userId,
      userChallengeId: challengeId,
      challengeEventId: ce.id,
    });

    const payload: Record<string, unknown> = {
      status: res.status,
      paymentIntentId: res.paymentIntentId,
      roll,
      amountCents,
    };
    if (rollBreakdown) payload.rollBreakdown = rollBreakdown;
    if (multiplier >= 10) payload.multiplier = 10;
    return reply.send(payload);
  } catch (err: any) {
    app.log.error(err);
    return reply.code(500).send({ error: err.message });
  }
});

// --- Push reminder job (runs every 15 min when PUSH_ENABLED and VAPID set) ---
const PUSH_JOB_INTERVAL_MS = 15 * 60 * 1000;

async function sendPushNotification(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; deeplink: string },
): Promise<{ ok: true } | { ok: false; statusCode: number }> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 86400 },
    );
    return { ok: true };
  } catch (e: any) {
    const statusCode = e?.statusCode ?? e?.response?.statusCode ?? 0;
    return { ok: false, statusCode };
  }
}

async function runPushReminderJob(): Promise<void> {
  if (!PUSH_ENABLED || !VAPID_PRIVATE_KEY) return;
  const now = new Date();
  const subs = await prisma.pushSubscription.findMany({
    where: { revokedAt: null },
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
  const byUser = new Map<string, typeof subs>();
  for (const s of subs) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }
  for (const [userId, userSubs] of byUser) {
    const remindable = await getRemindableChallenges(userId, now);
    for (const r of remindable) {
      let sent = false;
      for (const sub of userSubs) {
        const result = await sendPushNotification(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { title: r.title, body: r.body, deeplink: r.deeplink },
        );
        if (result.ok) {
          sent = true;
        } else if (result.statusCode === 410 || result.statusCode === 404) {
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { revokedAt: now },
          });
          app.log.info({ subscriptionId: sub.id, statusCode: result.statusCode }, "push subscription revoked (gone)");
        }
      }
      if (sent) {
        await prisma.challengeReminder.upsert({
          where: {
            userChallengeId_dueWindowKey_channel: {
              userChallengeId: r.userChallengeId,
              dueWindowKey: r.dueWindowKey,
              channel: "PUSH",
            },
          },
          create: {
            userChallengeId: r.userChallengeId,
            dueWindowKey: r.dueWindowKey,
            channel: "PUSH",
          },
          update: {},
        });
      }
    }
  }
}

// --- Weekly recap (POWER): run on Sunday UTC, e.g. cron POST /cron/weekly-recap ---
async function runWeeklyRecapJob(): Promise<{ sent: number; errors: number }> {
  const now = new Date();
  const weekStart = startOfWeekUtc(now);
  const weekEnd = addDaysUtc(weekStart, 7);

  const users = await prisma.user.findMany({
    where: {
      email: { not: null },
      tier: { in: ["POWER", "DEV"] },
    },
    select: { id: true, email: true },
  });

  let sent = 0;
  let errors = 0;
  for (const u of users) {
    const email = (u as any).email;
    if (!email || typeof email !== "string") continue;
    try {
      const [savedAgg, completedAgg, missedAgg, streak] = await Promise.all([
        prisma.paymentIntent.aggregate({
          where: {
            userId: u.id,
            type: "DEPOSIT",
            status: "SETTLED",
            createdAt: { gte: weekStart, lt: weekEnd },
            metadata: { path: ["source"], equals: "challenge" },
          },
          _sum: { amountCents: true },
        }),
        prisma.challengeEvent.count({
          where: {
            userChallenge: { userId: u.id },
            scheduledFor: { gte: weekStart, lt: weekEnd },
            paymentIntentId: { not: null },
          },
        }),
        prisma.challengeEvent.count({
          where: {
            userChallenge: { userId: u.id },
            scheduledFor: { gte: weekStart, lt: weekEnd },
            paymentIntentId: null,
          },
        }),
        getStreakForUser(u.id),
      ]);
      const totalSavedCents = savedAgg._sum.amountCents ?? 0;
      const payload: WeeklyRecapPayload = {
        totalSavedCents,
        challengesCompleted: completedAgg,
        challengesMissed: missedAgg,
        currentStreakDays: streak?.currentStreakDays ?? 0,
        bestStreakDays: streak?.bestStreakDays ?? 0,
      };
      const result = await sendWeeklyRecapEmail(email, payload);
      if (result.ok) sent += 1;
      else {
        errors += 1;
        app.log.warn({ userId: u.id, error: (result as any).error }, "weekly recap send failed");
      }
    } catch (e: any) {
      errors += 1;
      app.log.error({ userId: u.id, err: e }, "weekly recap error");
    }
  }
  return { sent, errors };
}

app.post("/cron/weekly-recap", async (req, reply) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && (req.headers as any)["x-cron-secret"] !== secret) {
    return reply.code(403).send({ error: "forbidden" });
  }
  const result = await runWeeklyRecapJob();
  return reply.send({ ok: true, ...result });
});

const port = Number(process.env.PORT ?? 4001);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  if (PUSH_ENABLED && VAPID_PRIVATE_KEY) {
    setTimeout(runPushReminderJob, 60 * 1000);
    setInterval(runPushReminderJob, PUSH_JOB_INTERVAL_MS);
    app.log.info("Push reminder job scheduled (every 15 min)");
  }
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

