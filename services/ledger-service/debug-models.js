import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
console.log("Available Models:", Object.keys(prisma).filter(k => !k.startsWith("$") && !k.startsWith("_")));
process.exit(0);
