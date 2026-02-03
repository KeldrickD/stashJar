import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.$queryRaw`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_name IN ('JournalEntry', 'PaymentIntent', 'UserChallenge', 'ChallengeEvent')
    AND column_name IN ('metadata', 'meta', 'context')
  `;
    console.log("COLUMNS IN DB:", JSON.stringify(result, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
