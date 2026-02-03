import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
    const users = await prisma.user.count();
    const templates = await prisma.challengeTemplate.count();
    const challenges = await prisma.userChallenge.count();
    console.log("COUNTS:", { users, templates, challenges });
    const all = await prisma.userChallenge.findMany({
        include: { template: true }
    });
    console.log("CHALLENGES:", JSON.stringify(all, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
