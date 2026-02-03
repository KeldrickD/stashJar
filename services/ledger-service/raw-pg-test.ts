import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
    connectionString: "postgresql://stashjar:stashjar@127.0.0.1:5432/stashjar?schema=public",
    connectionTimeoutMillis: 2000
});

async function run() {
    try {
        console.log("Testing raw PG connection...");
        const res = await pool.query("SELECT 1 as result");
        console.log("Result:", res.rows[0].result);

        console.log("Checking tables...");
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log("Tables:", tables.rows.map(r => r.table_name).join(", "));

        console.log("Checking UserChallenge columns...");
        const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'UserChallenge'");
        console.log("Columns:", cols.rows.map(r => `${r.column_name} (${r.data_type})`).join(", "));

        console.log("SUCCESS");
    } catch (e: any) {
        console.error("PG TEST FAILED");
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
