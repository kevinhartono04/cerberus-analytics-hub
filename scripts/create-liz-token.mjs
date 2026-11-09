import { randomBytes, createHash } from "node:crypto";

const token = `liz_${randomBytes(32).toString("base64url")}`;
console.log("Liz secret (store in Liz's secret manager; do not commit or share in chat):");
console.log(token);
console.log("\nCerebral server environment variable (SHA-256 hash only):");
console.log(`CEREBRAL_LIZ_TOKEN_SHA256=${createHash("sha256").update(token).digest("hex")}`);
