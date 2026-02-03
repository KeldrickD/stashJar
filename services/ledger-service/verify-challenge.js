async function main() {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const baseUrl = "http://127.0.0.1:4555";

    async function call(path, method = "GET", body = null) {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : null
        });
        const text = await res.text();
        console.log(`[DEBUG] ${method} ${path} -> Status: ${res.status}`);
        if (!res.ok) {
            console.error(`[DEBUG] Error Body: ${text}`);
            throw new Error(`${method} ${path} failed with status ${res.status}`);
        }
        return JSON.parse(text);
    }

    console.log("1. Creating User...");
    const user = await call("/users", "POST");
    const userId = user.userId;
    console.log("User Created:", userId);

    console.log("\n2. Seeding Challenge Template...");
    const template = await call("/debug/seed/challenges", "POST");
    console.log("Template Seeded:", template.templateId);

    console.log("\n3. Starting 52-Week Challenge...");
    // Use today - 10 days to ensure it's due
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    const start = await call("/challenges/start", "POST", {
        userId,
        templateSlug: "52_week",
        startDate: pastDate.toISOString()
    });
    console.log("Challenge Started. Initial nextRunAt:", start.nextRunAt);

    console.log("\n--- Challenge State Before Run ---");
    const stateBefore = await call("/debug/challenges");
    console.dir(stateBefore, { depth: null });

    console.log("\n4. Running Due Challenges (Looping for catch-up)...");
    let totalProcessed = 0;
    let run;
    do {
        run = await call("/challenges/run-due", "POST");
        console.log("Processed in this run:", run.processed);
        totalProcessed += run.processed;
    } while (run.processed > 0);
    console.log("Total Processed:", totalProcessed);

    console.log("\n--- Challenge State After Run ---");
    const stateAfter = await call("/debug/challenges");
    console.dir(stateAfter, { depth: null });

    console.log("\n5. Checking Transaction History...");
    const history = await call(`/users/${userId}/transactions`);
    console.log("Found Transactions:", history.transactions.length);
    console.dir(history.transactions, { depth: null });

    if (history.transactions.length > 0) {
        console.log("\n✅ CHALLENGE ENGINE VERIFIED");
    } else {
        console.log("\n❌ VERIFICATION FAILED: No ledger entry found");
    }
}

main().catch(e => {
    console.error("VERIFICATION FAILED:", e.message);
    process.exit(1);
});
