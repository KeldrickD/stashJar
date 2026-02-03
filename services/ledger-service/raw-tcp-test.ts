import net from 'net';

const client = new net.Socket();
client.setTimeout(5000);

console.log("Connecting to 127.0.0.1:5432...");
client.connect(5432, '127.0.0.1', () => {
    console.log("CONNECTED TO PORT 5432!");
    client.destroy();
});

client.on('error', (err) => {
    console.error("CONNECTION ERROR:", err.message);
    process.exit(1);
});

client.on('timeout', () => {
    console.error("CONNECTION TIMEOUT");
    client.destroy();
    process.exit(1);
});
