import "dotenv/config";
import pg from "pg";
const { Client } = pg;

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();

    const res = await client.query(`
        SELECT conname, pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public'
    `);

    console.log("DB Constraints:");
    res.rows.forEach(r => console.log(`- ${r.conname}: ${r.pg_get_constraintdef}`));
    await client.end();
}
main().catch(console.error);
