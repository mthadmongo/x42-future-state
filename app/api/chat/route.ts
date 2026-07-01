import { NextRequest, NextResponse } from "next/server";
import { appendTurn, getTurns } from "../../../src/services/history";
import { getCache } from "../../../src/services/cache";
import { answerQuestion } from "../../../src/services/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { patientId, question } = await req.json();
  if (!patientId || !question) {
    return NextResponse.json({ error: "patientId and question are required" }, { status: 400 });
  }

  const cache = await getCache();

  // 1. Semantic cache lookup (patient-scoped)
  const hit = await cache.lookupForPatient({ question, patientId });
  if (hit) {
    await appendTurn(patientId, "human", question);
    await appendTurn(patientId, "ai", hit.answer);
    return NextResponse.json({ answer: hit.answer, cached: true, intent: hit.intent, score: hit.score });
  }

  // 2. Miss → run the agent grounded in this patient's data
  const history = await getTurns(patientId);
  const result = await answerQuestion(patientId, question, history);

  // 3. Store in cache (volatile intents are skipped) + append history
  await cache.storeForPatient({
    question,
    patientId,
    answer: result.answer,
    intent: result.intent,
  });
  await appendTurn(patientId, "human", question);
  await appendTurn(patientId, "ai", result.answer);

  return NextResponse.json({ answer: result.answer, cached: false, intent: result.intent, toolsUsed: result.toolsUsed });
}
