import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    console.log("Database URL:", process.env.DATABASE_URL?.substring(0, 20) + "...");
    const challenges = await prisma.userChallenge.findMany({
        include: { template: true, events: true }
    });
    console.dir(challenges, { depth: null });

    const now = new Date();
    console.log("Now (UTC):", now.toISOString());

    const due = await prisma.userChallenge.findMany({
        where: {
            status: "ACTIVE",
            nextRunAt: { lte: now }
        }
    });
    console.log("Due Count:", due.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
