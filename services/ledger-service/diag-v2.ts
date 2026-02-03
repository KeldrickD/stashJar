import "dotenv/config";
import { PrismaClient } from "./src/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({
    adapter,
    log: ['query', 'error']
});

async function main() {
    try {
        console.log("1. Seeding templates...");
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
            console.log(`Upserting ${t.slug}...`);
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
        console.log("Seeding SUCCESS");

        console.log("2. Creating User...");
        const user = await prisma.user.create({ data: {} });
        console.log("User ID:", user.id);

        console.log("3. Starting 100 Envelopes...");
        const rules = templates.find(t => t.slug === "100_envelopes")!.defaultRules;
        const pool = Array.from(
            { length: (rules.max ?? 100) - (rules.min ?? 1) + 1 },
            (_, i) => (rules.min ?? 1) + i,
        );
        const state = {
            remaining: pool,
            used: [],
        };

        const uc = await prisma.userChallenge.create({
            data: {
                userId: user.id,
                name: "100 Envelopes",
                startDate: new Date(),
                rules: rules as any,
                state: state as any,
                status: "ACTIVE"
            } as any
        });
        console.log("Challenge ID:", uc.id);

        console.log("4. Verifying state exists...");
        const check = await prisma.userChallenge.findUnique({
            where: { id: uc.id }
        });
        console.log("State in DB:", (check as any).state ? "PRESENT" : "MISSING");

        console.log("DONE");
    } catch (e: any) {
        console.error("DIAGNOSTIC FAILED");
        console.error("MESSAGE:", e.message);
        console.error("CODE:", e.code);
        process.exit(1);
    }
}

main().finally(() => {
    prisma.$disconnect();
    pool.end();
});
