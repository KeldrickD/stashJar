import "dotenv/config";
import { PrismaClient, Prisma } from "./src/generated/client";
const prisma = new PrismaClient();

async function main() {
    const journalEntryModel = Prisma.dmmf.datamodel.models.find(m => m.name === "JournalEntry");
    console.log("JournalEntry Fields in DMMF:");
    journalEntryModel?.fields.forEach(f => console.log(`- ${f.name} (DB Name: ${f.dbName ?? f.name})`));
}
main().catch(console.error).finally(() => prisma.$disconnect());
