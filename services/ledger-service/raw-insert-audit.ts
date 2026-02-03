import "dotenv/config";
import pg from "pg";
const { Client } = pg;

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();
    console.log("CONNECTED TO PG");

    try {
        const res = await client.query(`
            INSERT INTO "JournalEntry" ("id", "idempotencyKey", "type", "context")
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            `raw_test_${Date.now()}`,
            `raw_idem_${Date.now()}`,
            'DEPOSIT_INITIATED',
            JSON.stringify({ raw: true })
        ]);
        console.log("INSERT SUCCESS:", res.rows[0]);
    } catch (e) {
        console.error("INSERT FAILED:");
        console.error(e);
    }

    await client.end();
}
main().catch(console.error);
