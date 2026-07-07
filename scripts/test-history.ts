import { appendTurn, clearMessages, getTurns } from "../src/services/history";
import {
  createConversation,
  deleteConversation,
  listConversations,
  touchConversation,
} from "../src/services/conversations";
import { listPatients } from "../src/services/patients";
import { closeClient } from "../src/lib/mongo";

async function main() {
  console.log("=== Phase 3 test-history (conversations) ===\n");
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  const patients = await listPatients();
  patients.length >= 2 ? pass(`listPatients returned ${patients.length}`) : fail("need >= 2 patients");
  const A = patients[0].id;
  const B = patients[1].id;

  // Two separate conversations for the SAME patient
  const convA1 = await createConversation(A);
  const convA2 = await createConversation(A);
  const convB = await createConversation(B);

  await appendTurn(convA1.id, "human", "How much of my deductible have I met?");
  await appendTurn(convA1.id, "ai", "You have met $399 of your $1000 deductible.");
  await appendTurn(convA2.id, "human", "What prescriptions am I on?");

  const t1 = await getTurns(convA1.id);
  const t2 = await getTurns(convA2.id);

  t1.length === 2 && t1[0].role === "human" && t1[1].role === "ai"
    ? pass("conversation A1 has its own 2 turns in order")
    : fail(`A1 turns wrong: ${JSON.stringify(t1)}`);

  t2.length === 1 && t2[0].content.includes("prescriptions")
    ? pass("conversation A2 has its own 1 turn (separate from A1)")
    : fail(`A2 turns wrong: ${JSON.stringify(t2)}`);

  (await getTurns(convA1.id)).length === 2
    ? pass("conversation A1 unaffected by A2 writes (per-conversation isolation)")
    : fail("conversation isolation broken");

  // Titles + listing
  await touchConversation(convA1.id, "How much of my deductible have I met?");
  const convos = await listConversations(A);
  convos.length >= 2 ? pass(`listConversations(A) returned ${convos.length}`) : fail("expected >= 2 conversations for A");
  convos.some((c) => c.title.startsWith("How much of my deductible"))
    ? pass("conversation title is derived from the first user message")
    : fail("conversation title not set from first message");

  // Patient B has its own conversations only
  const convosB = await listConversations(B);
  convosB.every((c) => c.patientId === B) && convosB.some((c) => c.id === convB.id)
    ? pass("patient B sees only its own conversations")
    : fail("patient conversation listing leaked across patients");

  // Clear + delete
  await clearMessages(convA1.id);
  (await getTurns(convA1.id)).length === 0 ? pass("clearMessages empties a conversation") : fail("clear failed");

  await deleteConversation(convA1.id);
  await deleteConversation(convA2.id);
  await deleteConversation(convB.id);
  const afterDelete = (await listConversations(A)).some((c) => c.id === convA1.id);
  !afterDelete ? pass("deleteConversation removes the conversation") : fail("delete failed");

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("test-history failed:", err);
  await closeClient();
  process.exit(1);
});
