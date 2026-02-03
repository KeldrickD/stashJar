import "dotenv/config";
import { Prisma } from "./src/generated/client";
import fs from "fs";

async function main() {
    const models = Prisma.dmmf.datamodel.models;
    fs.writeFileSync("prisma-dmmf.txt", JSON.stringify(models, null, 2));
    console.log("DMMF written to prisma-dmmf.txt");
}
main().catch(console.error);
