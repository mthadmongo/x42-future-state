import { COLLECTIONS, config } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";
import { generateData } from "../src/data/generate";

async function main() {
  console.log(`=== Phase 1 seed → db "${config.mongo.db}" ===\n`);
  const data = generateData();
  const db = await getDb();

  const datasets: Array<[string, object[]]> = [
    [COLLECTIONS.providers, data.providers],
    [COLLECTIONS.patients, data.patients],
    [COLLECTIONS.coverage, data.coverage],
    [COLLECTIONS.claims, data.claims],
    [COLLECTIONS.prescriptions, data.prescriptions],
  ];

  for (const [name, docs] of datasets) {
    const col = db.collection(name);
    await col.deleteMany({});
    if (docs.length > 0) await col.insertMany(docs as any[]);
    console.log(`  ${name}: inserted ${docs.length}`);
  }

  console.log("\nCreating regular indexes...");
  await db.collection(COLLECTIONS.patients).createIndex({ "name.last": 1 });
  await db.collection(COLLECTIONS.coverage).createIndex({ patientId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.claims).createIndex({ patientId: 1, status: 1 });
  await db.collection(COLLECTIONS.claims).createIndex({ patientId: 1, serviceDate: -1 });
  await db.collection(COLLECTIONS.prescriptions).createIndex({ patientId: 1, status: 1 });
  console.log("  done.");

  await closeClient();
  console.log("\nSeed complete.");
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await closeClient();
  process.exit(1);
});
