async function main() {
    console.log("--- Checking /users ---");
    const res = await fetch("http://localhost:4055/users", { method: "POST" });
    console.log("Status:", res.status, await res.text());

    console.log("\n--- Checking /debug/seed/challenges ---");
    const res2 = await fetch("http://localhost:4055/debug/seed/challenges", { method: "POST" });
    console.log("Status:", res2.status, await res2.text());
}
main().catch(console.error);
