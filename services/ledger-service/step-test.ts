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
        console.log("1. User.create");
        const user = await prisma.user.create({ data: {} });

        console.log("2. PaymentIntent.create");
        const pi = await prisma.paymentIntent.create({
            data: {
                userId: user.id,
                type: "DEPOSIT",
                amountCents: 100,
                idempotencyKey: `diag_pi_${Date.now()}`,
                metadata: { test: true } as any
            } as any
        });
        console.log("PaymentIntent.create SUCCESS:", pi.id);

        console.log("DONE");
    } catch (e: any) {
        console.error("DIAGNOSTIC FAILED");
        console.error("MESSAGE:", e.message);
        console.error("CODE:", e.code);
        process.exit(1);
    }
}

main().finally(() => prisma.$disconnect());
