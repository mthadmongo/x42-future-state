import { classifyIntent, ROUTER_CONFIDENCE_THRESHOLD } from "../src/services/intents";
import { answerQuestion } from "../src/services/agent";
import { closeClient } from "../src/lib/mongo";

const CASES: Array<{ q: string; expected: string }> = [
  { q: "can you pull up my medical claims", expected: "getClaims" },
  { q: "what's left on my deductible this year", expected: "getDeductibleStatus" },
  { q: "which medicines am I currently prescribed", expected: "getPrescriptions" },
  { q: "who is my primary doctor", expected: "getProviderInfo" },
  { q: "what plan do I have and my copay amounts", expected: "getCoverageSummary" },
  { q: "explain what a copay is", expected: "generalHealthEducation" },
];

async function main() {
  console.log("=== Phase 6 test-intents ===");
  console.log(`(router confidence threshold = ${ROUTER_CONFIDENCE_THRESHOLD})\n`);
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  // 1. Classification accuracy (embedding-only, cheap)
  let correct = 0;
  let aboveThreshold = 0;
  for (const c of CASES) {
    const m = await classifyIntent(c.q);
    const ok = m?.intent === c.expected;
    if (ok) correct++;
    if (m && m.score >= ROUTER_CONFIDENCE_THRESHOLD) aboveThreshold++;
    console.log(`  "${c.q}" → ${m?.intent} (${m?.score.toFixed(3)}) ${ok ? "✓" : `✗ expected ${c.expected}`}`);
  }
  correct === CASES.length
    ? pass(`all ${CASES.length} utterances classified to the correct intent`)
    : fail(`${CASES.length - correct}/${CASES.length} misclassified`);
  console.log(`  (${aboveThreshold}/${CASES.length} exceeded the routing confidence threshold)\n`);

  // 2. Router mode end-to-end on a clear question
  const routed = await answerQuestion("pat_0001", "how much of my deductible have I met?", [], "router");
  console.log(`  router-mode: mode=${routed.mode} routed=${routed.routed} intent=${routed.intent} score=${routed.intentScore?.toFixed(3)}`);
  console.log(`    A: ${routed.answer.slice(0, 120)}\n`);
  routed.mode === "router" && routed.routed && routed.intent === "getDeductibleStatus"
    ? pass("router mode classified + routed a clear question to getDeductibleStatus")
    : fail(`router mode did not route as expected: ${JSON.stringify({ mode: routed.mode, routed: routed.routed, intent: routed.intent })}`);

  // 3. Out-of-domain question → low confidence → fallback to LLM
  const ood = await answerQuestion("pat_0001", "what is the weather in Paris today?", [], "router");
  console.log(`  out-of-domain: routed=${ood.routed} intentScore=${ood.intentScore?.toFixed(3)}`);
  ood.routed === false
    ? pass("out-of-domain question falls back to LLM (not routed)")
    : fail("out-of-domain question was incorrectly routed");

  // 4. LLM mode label
  const llm = await answerQuestion("pat_0001", "what plan am I on?", [], "llm");
  llm.mode === "llm"
    ? pass("llm mode reports mode=llm")
    : fail(`llm mode label wrong: ${llm.mode}`);

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-intents failed:", err);
  await closeClient();
  process.exit(1);
});
