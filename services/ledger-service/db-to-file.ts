import "dotenv/config";
import pg from "pg";
import fs from "fs";
const { Client } = pg;

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();

    const res = await client.query(`
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        ORDER BY table_name, column_name
    `);

    let out = "TABLE_NAME | COLUMN_NAME | DATA_TYPE\n";
    out += "--------------------------------------\n";
    res.rows.forEach(r => {
        out += `${r.table_name} | ${r.column_name} | ${r.data_type}\n`;
    });

    fs.writeFileSync("db-schema.txt", out);
    console.log("DB Schema written to db-schema.txt");
    await client.end();
}
main().catch(console.error);
