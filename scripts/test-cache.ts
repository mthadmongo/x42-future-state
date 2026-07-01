import { getCache } from "../src/services/cache";
import { COLLECTIONS } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";

const A = "pat_0001";
const B = "pat_0002";

async function wipeTestEntries() {
  const db = await getDb();
  await db.collection(COLLECTIONS.semanticCache).deleteMany({ patientId: { $in: [A, B] } });
}

async function main() {
  console.log("=== Phase 4 test-cache ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  await wipeTestEntries();
  const cache = await getCache();

  // Store a non-volatile Q&A for patient A
  const q = "How many prescriptions am I currently taking?";
  const answer = "You currently have 4 active prescriptions.";
  const s = await cache.storeForPatient({ question: q, patientId: A, answer, intent: "getPrescriptions" });
  s.stored ? pass("stored a non-volatile Q&A for patient A") : fail("failed to store");

  // Allow the vector index to pick up the new document
  await new Promise((r) => setTimeout(r, 4000));

  // 1. Exact-question HIT for A
  let hit = await cache.lookupForPatient({ question: q, patientId: A });
  hit && hit.score >= 0.9
    ? pass(`exact question is a HIT (score=${hit!.score.toFixed(4)})`)
    : fail(`exact question did not hit (${JSON.stringify(hit)})`);

  // 2. Paraphrase HIT for A
  hit = await cache.lookupForPatient({
    question: "How many meds am I taking right now?",
    patientId: A,
  });
  hit
    ? pass(`paraphrase is a HIT (score=${hit.score.toFixed(4)}, cached="${hit.cachedQuestion}")`)
    : fail("paraphrase did not hit (threshold may be too high)");

  // 3. Cross-patient MISS (isolation)
  const bHit = await cache.lookupForPatient({ question: q, patientId: B });
  bHit === null
    ? pass("same question for patient B is a MISS (isolation holds)")
    : fail(`isolation broken: patient B got a hit: ${JSON.stringify(bHit)}`);

  // 4. Volatile intent is NOT cached
  const vol = await cache.storeForPatient({
    question: "How much of my deductible have I met?",
    patientId: A,
    answer: "You have met $399 of your $1000 deductible.",
    intent: "getDeductibleStatus",
  });
  !vol.stored && vol.reason === "volatile"
    ? pass("volatile intent (getDeductibleStatus) is skipped by the cache")
    : fail("volatile intent was cached but should not be");

  await new Promise((r) => setTimeout(r, 2000));
  const volLookup = await cache.lookupForPatient({
    question: "How much of my deductible have I met?",
    patientId: A,
  });
  volLookup === null
    ? pass("volatile question is not retrievable from cache")
    : fail("volatile question unexpectedly found in cache");

  await wipeTestEntries();
  console.log("  cleaned up test cache entries");

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-cache failed:", err);
  await closeClient();
  process.exit(1);
});
