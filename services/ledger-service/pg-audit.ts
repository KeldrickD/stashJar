import "dotenv/config";
import pg from "pg";
const { Client } = pg;

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();
    console.log("CONNECTED TO PG");

    const res = await client.query(`
        SELECT table_name, column_name 
        FROM information_schema.columns 
        WHERE table_name IN ('JournalEntry', 'PaymentIntent', 'UserChallenge', 'ChallengeEvent')
        ORDER BY table_name, column_name
    `);

    console.log("COLUMNS:", res.rows);
    await client.end();
}
main().catch(console.error);
