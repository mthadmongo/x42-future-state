import { appendTurn, clearHistory, getTurns } from "../src/services/history";
import { listPatients } from "../src/services/patients";
import { closeClient } from "../src/lib/mongo";

async function main() {
  console.log("=== Phase 3 test-history ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  // 0. Patients list works
  const patients = await listPatients();
  patients.length >= 2 ? pass(`listPatients returned ${patients.length}`) : fail("need >= 2 patients");
  const [a, b] = [patients[0].id, patients[1].id];

  // Clean slate
  await clearHistory(a);
  await clearHistory(b);

  // 1. Append + persist for patient A
  await appendTurn(a, "human", "How much of my deductible have I met?");
  await appendTurn(a, "ai", "You have met $399 of your $1000 deductible.");
  const turnsA = await getTurns(a);
  turnsA.length === 2 && turnsA[0].role === "human" && turnsA[1].role === "ai"
    ? pass(`patient A has 2 persisted turns in correct order`)
    : fail(`patient A history wrong: ${JSON.stringify(turnsA)}`);

  // 2. Patient B is isolated
  await appendTurn(b, "human", "What prescriptions am I on?");
  const turnsB = await getTurns(b);
  turnsB.length === 1 && turnsB[0].content.includes("prescriptions")
    ? pass("patient B has its own 1 turn")
    : fail(`patient B history wrong: ${JSON.stringify(turnsB)}`);

  const reReadA = await getTurns(a);
  reReadA.length === 2
    ? pass("patient A history unaffected by patient B writes (isolation)")
    : fail(`isolation broken: patient A now has ${reReadA.length} turns`);

  // 3. Persistence across new history instances (re-fetch)
  const persisted = await getTurns(a);
  persisted[0].content.includes("deductible")
    ? pass("patient A history persisted and reloads")
    : fail("patient A history did not persist");

  // Cleanup
  await clearHistory(a);
  await clearHistory(b);
  const clearedA = await getTurns(a);
  clearedA.length === 0 ? pass("clearHistory empties a patient's history") : fail("clear failed");

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-history failed:", err);
  await closeClient();
  process.exit(1);
});
