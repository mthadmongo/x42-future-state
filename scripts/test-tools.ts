import { seedTools, loadToolDefs, toolsForIntent } from "../src/services/toolRegistry";
import { runToolChain } from "../src/services/toolChain";
import { INTENT_TOOLS, TOOL_REGISTRY } from "../src/data/toolDefs";
import { INTENT_EXAMPLES } from "../src/services/intents";
import { COLLECTIONS } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";

async function main() {
  console.log("=== test-tools (registry + intent mapping) ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  // 1. Seed + count
  const n = await seedTools();
  const defs = await loadToolDefs();
  n === TOOL_REGISTRY.length && defs.size === TOOL_REGISTRY.length
    ? pass(`seeded ${n} tool definitions into the tools collection`)
    : fail(`tool count mismatch: seeded ${n}, loaded ${defs.size}, expected ${TOOL_REGISTRY.length}`);

  // 2. Registry docs are well-formed
  let malformed = 0;
  for (const t of defs.values()) {
    if (!t.name || !t.operation || !Array.isArray(t.inputs) || !Array.isArray(t.outputs)) malformed++;
    if (t.operation !== "compute" && !t.targetCollection) malformed++;
  }
  malformed === 0 ? pass("all tool definitions are well-formed") : fail(`${malformed} malformed tool definition(s)`);

  // 3. Every intent maps only to tools that exist in the registry
  let badRefs = 0;
  for (const [intent, tools] of Object.entries(INTENT_TOOLS)) {
    for (const tn of tools) if (!defs.has(tn)) { badRefs++; console.log(`   ${intent} → missing tool "${tn}"`); }
  }
  badRefs === 0 ? pass("every intent → tool mapping references existing tools") : fail(`${badRefs} dangling tool reference(s)`);

  // 4. Every classifiable intent has a mapping entry
  const missing = Object.keys(INTENT_EXAMPLES).filter((i) => !(i in INTENT_TOOLS));
  missing.length === 0
    ? pass("every classifiable intent has a tool-chain mapping")
    : fail(`intents without a mapping: ${missing.join(", ")}`);

  // 5. Intent documents in MongoDB carry the tools[] mapping (run `seed-tools` first)
  const db = await getDb();
  const sampleIntent = "getDeductibleStatus";
  const doc = await db.collection(COLLECTIONS.intents).findOne({ intent: sampleIntent });
  const expected = toolsForIntent(sampleIntent);
  doc && JSON.stringify(doc.tools) === JSON.stringify(expected)
    ? pass(`intent docs carry tools[] (e.g. ${sampleIntent} → [${expected.join(", ")}])`)
    : fail(`intent doc tools[] missing/mismatched for ${sampleIntent} (got ${JSON.stringify(doc?.tools)}; run "npm run seed-tools")`);

  // 6. Deterministic chain execution (no LLM) grounded in a known patient's data
  const P = "pat_0001";
  const coverage = await db.collection<any>(COLLECTIONS.coverage).findOne({ patientId: P });

  const deductibleChain = await runToolChain("getDeductibleStatus", P);
  const ds: any = deductibleChain.data.deductibleStatus;
  deductibleChain.toolsRun.join(",") === "resolvePatientContext,getCoverageByPatient,computeDeductibleStatus"
    ? pass("getDeductibleStatus ran the full 3-tool chain in order")
    : fail(`unexpected chain: ${deductibleChain.toolsRun.join(",")}`);
  ds && ds.deductible?.met === coverage.deductible.met &&
    ds.deductible?.remaining === Math.round((coverage.deductible.individual - coverage.deductible.met) * 100) / 100
    ? pass(`computeDeductibleStatus derived correct met/remaining (${ds.deductible.met}/${ds.deductible.remaining})`)
    : fail(`deductible derivation wrong: ${JSON.stringify(ds?.deductible)}`);

  const claimsChain = await runToolChain("getClaims", P);
  Array.isArray(claimsChain.data.claims) && (claimsChain.data.claims as any[]).every((c) => c.patientId === P)
    ? pass(`getClaims chain returned ${(claimsChain.data.claims as any[]).length} claims, all scoped to the patient`)
    : fail("getClaims chain returned wrong/unscoped data");

  const rxChain = await runToolChain("getPrescriptions", P);
  Array.isArray(rxChain.data.prescriptions)
    ? pass(`getPrescriptions chain returned ${(rxChain.data.prescriptions as any[]).length} prescriptions`)
    : fail("getPrescriptions chain failed");

  // param-requiring tool: findClaimById with an explicit param
  const aClaim = await db.collection<any>(COLLECTIONS.claims).findOne({ patientId: P });
  const statusChain = await runToolChain("getClaimStatus", P, { claimId: aClaim._id });
  (statusChain.data.claim as any)?._id === aClaim._id
    ? pass(`getClaimStatus chain resolved the claim by id (${aClaim._id})`)
    : fail(`getClaimStatus chain did not resolve the claim: ${JSON.stringify(statusChain.data.claim)}`);

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-tools failed:", err);
  await closeClient();
  process.exit(1);
});
