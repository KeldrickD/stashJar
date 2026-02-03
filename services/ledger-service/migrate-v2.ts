import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log("Running manual migration...");
        await pool.query('ALTER TABLE "UserChallenge" ADD COLUMN IF NOT EXISTS "state" JSONB;');
        console.log("SUCCESS: state column added.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await pool.end();
    }
}

run();
