import { generateKeyPairSync, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../db/schema.js";

const ORGS = [
  { displayName: "Mock GPay", orgType: "PSP" as const, maxTps: 200 },
  { displayName: "Mock PhonePe", orgType: "PSP" as const, maxTps: 200 },
  { displayName: "Mock Paytm", orgType: "PSP" as const, maxTps: 100 },
  { displayName: "Mock SBI", orgType: "BANK" as const, maxTps: 150 },
  { displayName: "Mock HDFC", orgType: "BANK" as const, maxTps: 150 },
  { displayName: "Mock ICICI", orgType: "BANK" as const, maxTps: 100 },
  { displayName: "Mock Axis", orgType: "BANK" as const, maxTps: 100 },
  { displayName: "Mock PNB", orgType: "BANK" as const, maxTps: 50 },
];

const PSP_CALLBACK_URLS: Record<string, string> = {
  "Mock GPay": "http://localhost:4001/callback/mock-gpay",
  "Mock PhonePe": "http://localhost:4001/callback/mock-phonepe",
  "Mock Paytm": "http://localhost:4001/callback/mock-paytm",
};

const VPA_HANDLES: Record<string, string> = {
  "Mock GPay": "gpay",
  "Mock PhonePe": "phonepe",
  "Mock Paytm": "paytm",
};

const TEST_VPAS = [
  { address: "alice@gpay", handle: "gpay", ifsc: "SBIN0000001", bankName: "Mock SBI" },
  { address: "bob@gpay", handle: "gpay", ifsc: "HDFC0000001", bankName: "Mock HDFC" },
  { address: "carol@phonepe", handle: "phonepe", ifsc: "ICIC0000001", bankName: "Mock ICICI" },
  { address: "dave@phonepe", handle: "phonepe", ifsc: "SBIN0000002", bankName: "Mock SBI" },
  { address: "eve@paytm", handle: "paytm", ifsc: "UTIB0000001", bankName: "Mock Axis" },
  { address: "frank@gpay", handle: "gpay", ifsc: "PUNB0000001", bankName: "Mock PNB" },
  { address: "grace@phonepe", handle: "phonepe", ifsc: "HDFC0000002", bankName: "Mock HDFC" },
  { address: "heidi@paytm", handle: "paytm", ifsc: "SBIN0000003", bankName: "Mock SBI" },
  { address: "ivan@gpay", handle: "gpay", ifsc: "ICIC0000002", bankName: "Mock ICICI" },
  { address: "judy@phonepe", handle: "phonepe", ifsc: "UTIB0000002", bankName: "Mock Axis" },
];

function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey: publicKey as string, privateKey: privateKey as string };
}

async function seed() {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://upi_admin:changeme_dev@localhost:5432/upi_switch";

  const pool = new pg.Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });

  console.log("Cleaning existing seed data...");
  await db.delete(schema.vpaMappings);
  await db.delete(schema.vpaHandles);
  await db.delete(schema.pendingCallbacks);
  await db.delete(schema.disputes);
  await db.delete(schema.settlementEntries);
  await db.delete(schema.settlementBatches);
  await db.delete(schema.outboxEvents);
  await db.delete(schema.processedEvents);
  await db.delete(schema.registeredOrgs);

  console.log("Seeding organizations...");
  const orgMap = new Map<string, { orgId: string; privateKey: string }>();

  for (const org of ORGS) {
    const orgId = randomUUID();
    const { publicKey, privateKey } = generateKeyPair();

    await db.insert(schema.registeredOrgs).values({
      orgId,
      orgType: org.orgType,
      displayName: org.displayName,
      status: "ACTIVE",
      publicKeyPem: publicKey,
      apiEndpoint: `http://localhost:4000/mock/${org.displayName.toLowerCase().replace(/\s+/g, "-")}`,
      callbackUrl: PSP_CALLBACK_URLS[org.displayName] ?? null,
      drEndpoint: `http://localhost:4000/mock/${org.displayName.toLowerCase().replace(/\s+/g, "-")}/dr`,
      maxTps: org.maxTps,
    });

    orgMap.set(org.displayName, { orgId, privateKey });
    console.log(`  ${org.displayName} (${org.orgType}): ${orgId}`);
  }

  console.log("\nSeeding VPA handles...");
  for (const [orgName, handle] of Object.entries(VPA_HANDLES)) {
    const org = orgMap.get(orgName)!;
    await db.insert(schema.vpaHandles).values({
      handle,
      owningOrgId: org.orgId,
      status: "ACTIVE",
    });
    console.log(`  @${handle} -> ${orgName}`);
  }

  console.log("\nSeeding VPA mappings...");
  for (const vpa of TEST_VPAS) {
    const pspName = Object.entries(VPA_HANDLES).find(([, h]) => h === vpa.handle)?.[0];
    const pspOrg = orgMap.get(pspName!)!;
    const bankOrg = orgMap.get(vpa.bankName)!;

    await db.insert(schema.vpaMappings).values({
      vpaAddress: vpa.address,
      handle: vpa.handle,
      accountNumberEncrypted: `enc_${vpa.address.replace("@", "_")}_account`,
      ifsc: vpa.ifsc,
      bankOrgId: bankOrg.orgId,
      pspOrgId: pspOrg.orgId,
      status: "ACTIVE",
    });
    console.log(`  ${vpa.address} (bank: ${vpa.bankName})`);
  }

  const seedOutput: Record<string, { orgId: string; privateKey: string }> = {};
  for (const [name, data] of orgMap) {
    seedOutput[name] = data;
  }

  const outDir = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(outDir, "../../.seed-keys.json");
  writeFileSync(outPath, JSON.stringify(seedOutput, null, 2));
  console.log(`\nPrivate keys written to ${outPath}`);

  await pool.end();
  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
