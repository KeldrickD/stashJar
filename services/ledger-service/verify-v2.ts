import axios from "axios";

const BASE_URL = "http://localhost:4555";

async function run() {
    console.log("--- STARTING V2 VERIFICATION ---");

    try {
        console.log("1. Seeding templates...");
        await axios.post(`${BASE_URL}/debug/seed/challenges`, {});

        console.log("2. Creating user...");
        const userRes = await axios.post(`${BASE_URL}/users`, {});
        const userId = userRes.data.userId;
        console.log("User ID:", userId);

        // --- 100 ENVELOPES ---
        console.log("\n3. Testing 100 Envelopes...");
        const startEnv = await axios.post(`${BASE_URL}/challenges/start`, {
            userId,
            templateSlug: "100_envelopes"
        });
        const challengeId = startEnv.data.userChallengeId;
        console.log("Envelope Challenge ID:", challengeId);
        console.log("Initial state:", JSON.stringify(startEnv.data.state));

        console.log("Drawing first envelope...");
        const draw1 = await axios.post(`${BASE_URL}/challenges/${challengeId}/draw`, {});
        console.log("Draw 1 result:", draw1.data);

        console.log("Drawing second envelope...");
        const draw2 = await axios.post(`${BASE_URL}/challenges/${challengeId}/draw`, {});
        console.log("Draw 2 result:", draw2.data);

        if (draw1.data.envelope === draw2.data.envelope) {
            throw new Error("Duplicate envelopes drawn!");
        }
        console.log("✅ Envelopes are unique.");

        // --- ROLL THE DICE ---
        console.log("\n4. Testing Roll-the-Dice...");
        const startDice = await axios.post(`${BASE_URL}/challenges/start`, {
            userId,
            templateSlug: "dice"
        });
        const diceId = startDice.data.userChallengeId;
        console.log("Dice Challenge ID:", diceId);

        console.log("Rolling dice...");
        const roll1 = await axios.post(`${BASE_URL}/challenges/${diceId}/roll`, {});
        console.log("Roll 1 result:", roll1.data);

        console.log("Rolling dice again...");
        const roll2 = await axios.post(`${BASE_URL}/challenges/${diceId}/roll`, {});
        console.log("Roll 2 result:", roll2.data);

        console.log("\n5. Checking transactions...");
        const txs = await axios.get(`${BASE_URL}/users/${userId}/transactions`);
        console.log(`Found ${txs.data.transactions.length} transactions.`);

        console.log("\n--- VERIFICATION SUCCESSFUL ---");
    } catch (e: any) {
        console.error("VERIFICATION FAILED");
        if (e.response) {
            console.error("Response data:", e.response.data);
        } else {
            console.error("Message:", e.message);
        }
        process.exit(1);
    }
}

run();
