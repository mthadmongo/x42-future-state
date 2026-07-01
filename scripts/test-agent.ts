import { answerQuestion } from "../src/services/agent";
import { COLLECTIONS } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";
import type { Claim, Coverage, Patient, Prescription } from "../src/types";

const PATIENT = "pat_0001";
const OTHER = "pat_0002";

async function main() {
  console.log("=== Phase 5 test-agent ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  const db = await getDb();
  const coverage = await db.collection<Coverage>(COLLECTIONS.coverage).findOne({ patientId: PATIENT } as any);
  const rx = await db.collection<Prescription>(COLLECTIONS.prescriptions).find({ patientId: PATIENT }).toArray();
  const claims = await db.collection<Claim>(COLLECTIONS.claims).find({ patientId: PATIENT }).toArray();
  const other = await db.collection<Patient>(COLLECTIONS.patients).findOne({ _id: OTHER } as any);

  const metInt = String(Math.trunc(coverage!.deductible.met));
  const activeRx = rx.filter((r) => r.status === "active").length;
  const deniedCount = claims.filter((c) => c.status === "denied").length;
  const otherLastName = other!.name.last;

  console.log(
    `Expected facts → deductible.met≈${coverage!.deductible.met} (int "${metInt}"), ` +
      `activeRx=${activeRx}, deniedClaims=${deniedCount}\n`,
  );

  // Q1: deductible
  const q1 = await answerQuestion(PATIENT, "How much of my deductible have I met so far?");
  console.log(`Q1 tools=${JSON.stringify(q1.toolsUsed)}\n  A1: ${q1.answer}\n`);
  q1.toolsUsed.includes("getDeductibleStatus") || q1.toolsUsed.includes("getCoverageSummary")
    ? pass("Q1 used a coverage/deductible tool")
    : fail(`Q1 did not use a coverage tool (used ${q1.toolsUsed})`);
  q1.answer.includes(metInt)
    ? pass(`Q1 answer contains the real deductible-met figure (${metInt})`)
    : fail(`Q1 answer missing deductible-met figure ${metInt}`);

  // Q2: active prescriptions
  const q2 = await answerQuestion(PATIENT, "How many active prescriptions do I currently have?");
  console.log(`Q2 tools=${JSON.stringify(q2.toolsUsed)}\n  A2: ${q2.answer}\n`);
  q2.toolsUsed.includes("getPrescriptions")
    ? pass("Q2 used getPrescriptions")
    : fail(`Q2 did not use getPrescriptions (used ${q2.toolsUsed})`);
  q2.answer.includes(String(activeRx))
    ? pass(`Q2 answer contains the real active-rx count (${activeRx})`)
    : fail(`Q2 answer missing active-rx count ${activeRx}`);

  // Q3: denied claims
  const q3 = await answerQuestion(PATIENT, "Do I have any denied claims?");
  console.log(`Q3 tools=${JSON.stringify(q3.toolsUsed)}\n  A3: ${q3.answer}\n`);
  q3.toolsUsed.includes("getClaims")
    ? pass("Q3 used getClaims")
    : fail(`Q3 did not use getClaims (used ${q3.toolsUsed})`);
  q3.answer.toLowerCase().includes("denied") || q3.answer.toLowerCase().includes("no ")
    ? pass("Q3 answer addresses denied claims")
    : fail("Q3 answer does not clearly address denied claims");

  // Cross-patient leakage check
  const leaked = [q1, q2, q3].some((r) => r.answer.includes(otherLastName));
  !leaked
    ? pass(`no cross-patient leakage (other patient's name "${otherLastName}" not present)`)
    : fail(`possible leakage: another patient's name "${otherLastName}" appeared`);

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-agent failed:", err);
  await closeClient();
  process.exit(1);
});
