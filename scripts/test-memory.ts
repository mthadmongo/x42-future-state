import { handleChat } from "../src/services/chat";
import { recallMemories, formMemories } from "../src/services/memory";
import { createConversation, deleteConversation } from "../src/services/conversations";
import { COLLECTIONS } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";

const A = "pat_0015";
const B = "pat_0016";

async function countMemories(patientId: string, type?: string): Promise<number> {
  const db = await getDb();
  const q: any = { patientId };
  if (type) q.type = type;
  return db.collection(COLLECTIONS.agentMemory).countDocuments(q);
}

async function wipe(patientId: string) {
  const db = await getDb();
  await db.collection(COLLECTIONS.agentMemory).deleteMany({ patientId });
  await db.collection(COLLECTIONS.semanticCache).deleteMany({ patientId });
}

async function main() {
  console.log("=== Memory test (long-term) ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  await wipe(A);
  await wipe(B);
  const convA = await createConversation(A);

  // 1. Formation: state a durable preference (cache miss → memory formed)
  const q1 = "Please remember that I prefer generic medications and I like using mail-order pharmacy.";
  const r1 = await handleChat({ patientId: A, conversationId: convA.id, question: q1, mode: "llm" });
  console.log(`  T1 cached=${r1.cached}; memory steps in trace: ${r1.trace.filter((s) => s.mongo?.collection === COLLECTIONS.agentMemory).length}`);
  !r1.cached ? pass("preference-stating turn was generated (miss)") : fail("T1 unexpectedly cached");

  await new Promise((r) => setTimeout(r, 4000)); // let agent_memory index catch up

  const prefCount = await countMemories(A, "preference");
  prefCount >= 1 ? pass(`formed ${prefCount} preference memory item(s) for patient A`) : fail("no preference memory formed");

  // 2. Recall surfaces the preference
  const recalled = await recallMemories(A, "what are my medication and pharmacy preferences?");
  const recalledText = recalled.map((m) => m.text.toLowerCase()).join(" | ");
  console.log(`  recalled: ${recalledText}`);
  /generic|mail[- ]?order/.test(recalledText)
    ? pass("recall surfaced the generic/mail-order preference")
    : fail("recall did not surface the stated preference");

  // 3. Cross-patient isolation
  const recalledB = await recallMemories(B, "what are my medication and pharmacy preferences?");
  recalledB.length === 0
    ? pass("patient B recalls no memories (isolation holds)")
    : fail(`isolation broken: B recalled ${recalledB.length} item(s)`);

  // 4. Dedup: re-forming the same preference does not create duplicates
  const beforeDedup = await countMemories(A, "preference");
  await formMemories({
    patientId: A,
    conversationId: convA.id,
    question: "Just a reminder, I prefer generic medications and mail-order pharmacy.",
    answer: "Understood — you prefer generic medications and mail-order pharmacy.",
    history: [],
  });
  await new Promise((r) => setTimeout(r, 3000));
  const afterDedup = await countMemories(A, "preference");
  afterDedup <= beforeDedup
    ? pass(`dedup: preference count did not grow (${beforeDedup} → ${afterDedup})`)
    : fail(`dedup failed: preference count grew ${beforeDedup} → ${afterDedup}`);

  // 5. Skip formation on a cache hit (exact repeat of q1)
  const totalBefore = await countMemories(A);
  const rHit = await handleChat({ patientId: A, conversationId: convA.id, question: q1, mode: "llm" });
  await new Promise((r) => setTimeout(r, 1500));
  const totalAfter = await countMemories(A);
  console.log(`  cache-hit repeat: cached=${rHit.cached}; memory count ${totalBefore} → ${totalAfter}`);
  rHit.cached && totalAfter === totalBefore
    ? pass("cache hit skipped memory formation (count unchanged)")
    : fail(`expected cached hit + unchanged memory count (cached=${rHit.cached}, ${totalBefore}→${totalAfter})`);

  // Cleanup
  await deleteConversation(convA.id);
  await wipe(A);
  await wipe(B);
  console.log("  cleaned up test data");

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-memory failed:", err);
  await closeClient();
  process.exit(1);
});
