import { extractParams } from "../src/services/params";
import { seedTools } from "../src/services/toolRegistry";
import { closeClient } from "../src/lib/mongo";

async function main() {
  console.log("=== Phase 4 test-params ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  await seedTools(); // ensure registry (with params) is present

  // 1. No-param intent → skip extraction, empty result (no LLM call)
  const none = await extractParams("getClaims", "show me my claims");
  Object.keys(none).length === 0 ? pass("no-param intent returns {} (extraction skipped)") : fail(`expected {}, got ${JSON.stringify(none)}`);

  // 2. Required param present
  const withId = await extractParams("getClaimStatus", "What is the status of claim clm_000123?");
  console.log(`  claimId extraction: ${JSON.stringify(withId)}`);
  withId.claimId === "clm_000123" ? pass("extracted claimId from the question") : fail(`claimId not extracted: ${JSON.stringify(withId)}`);

  // 3. Required param absent → omitted (handled downstream)
  const noId = await extractParams("getClaimStatus", "What's the status of my claim?");
  console.log(`  no-id extraction: ${JSON.stringify(noId)}`);
  noId.claimId === undefined ? pass("absent claimId is omitted (not hallucinated)") : fail(`claimId should be absent: ${JSON.stringify(noId)}`);

  // 4. Optional param present
  const withDrug = await extractParams("getRefillInfo", "How many refills of Lisinopril do I have left?");
  console.log(`  drugName extraction: ${JSON.stringify(withDrug)}`);
  typeof withDrug.drugName === "string" && /lisinopril/i.test(withDrug.drugName)
    ? pass("extracted optional drugName from the question")
    : fail(`drugName not extracted: ${JSON.stringify(withDrug)}`);

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-params failed:", err);
  await closeClient();
  process.exit(1);
});
