import "dotenv/config";
import { PrismaClient } from "./src/generated/client";
const prisma = new PrismaClient();

async function main() {
    try {
        console.log("Attempting to create JournalEntry...");
        await prisma.journalEntry.create({
            data: {
                idempotencyKey: `test_${Date.now()}`,
                type: "DEPOSIT_INITIATED",
                metadata: { test: true } as any
            } as any
        });
    } catch (e: any) {
        console.error("CAUGHT ERROR:");
        console.error(e);
        if (e.request) console.error("REQUEST:", e.request);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
