import { handleChat } from "../src/services/chat";
import { getMetrics, resetMetrics } from "../src/services/metrics";
import { clearHistory, getTurns } from "../src/services/history";
import { COLLECTIONS } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";

const A = "pat_0007";
const B = "pat_0008";

async function cleanup() {
  const db = await getDb();
  await db.collection(COLLECTIONS.semanticCache).deleteMany({ patientId: { $in: [A, B] } });
  await clearHistory(A);
  await clearHistory(B);
}

async function main() {
  console.log("=== Phase 7 test-integration ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  await cleanup();
  await resetMetrics();

  // 1. First ask (miss → generated)
  const r1 = await handleChat({ patientId: A, question: "What insurance plan am I on and what are my copays?", mode: "llm" });
  console.log(`  r1 cached=${r1.cached} intent=${r1.intent} mode=${r1.mode}`);
  !r1.cached && r1.intent === "getCoverageSummary"
    ? pass("first ask is generated (miss) and used coverage tool")
    : fail(`unexpected first ask: ${JSON.stringify({ cached: r1.cached, intent: r1.intent })}`);

  await new Promise((r) => setTimeout(r, 4000)); // let the vector index see the new cache doc

  // 2. Paraphrase (hit → cached)
  const r2 = await handleChat({ patientId: A, question: "Which health plan do I have and what are the copays?", mode: "llm" });
  console.log(`  r2 cached=${r2.cached} score=${r2.score?.toFixed(3)}`);
  r2.cached && (r2.score ?? 0) >= 0.9
    ? pass(`paraphrase served from cache (score=${r2.score?.toFixed(3)})`)
    : fail(`paraphrase not served from cache: ${JSON.stringify(r2)}`);

  // 3. Cross-patient isolation end-to-end
  const rB = await handleChat({ patientId: B, question: "Which health plan do I have and what are the copays?", mode: "llm" });
  !rB.cached
    ? pass("same paraphrase for a different patient is NOT a cache hit (isolation)")
    : fail("cross-patient cache hit — isolation broken");

  // 4. Metrics reflect the traffic
  const m = await getMetrics();
  console.log(`  metrics: hits=${m.hits} misses=${m.misses} hitRate=${(m.hitRate * 100).toFixed(0)}% estTokensSaved=${m.estTokensSaved}`);
  m.hits >= 1 && m.misses >= 2 && m.estTokensSaved > 0
    ? pass("metrics counted hits, misses, and estimated tokens saved")
    : fail(`metrics look wrong: ${JSON.stringify(m)}`);

  // 5. Router mode still works end-to-end
  const rR = await handleChat({ patientId: A, question: "how much of my deductible have I met?", mode: "router" });
  console.log(`  router: mode=${rR.mode} routed=${rR.routed} intent=${rR.intent}`);
  rR.mode === "router" && rR.intent === "getDeductibleStatus"
    ? pass("router mode routes deductible question end-to-end")
    : fail(`router mode failed: ${JSON.stringify({ mode: rR.mode, intent: rR.intent })}`);

  // 6. History persisted for patient A
  const turns = await getTurns(A);
  turns.length >= 6
    ? pass(`conversation history persisted (${turns.length} turns for patient A)`)
    : fail(`history too short: ${turns.length}`);

  await cleanup();
  await resetMetrics();
  console.log("  cleaned up test data + reset metrics");

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-integration failed:", err);
  await closeClient();
  process.exit(1);
});
