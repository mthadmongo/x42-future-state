import { config } from "../config";
import { getCache } from "./cache";
import { getTurns, appendTurn } from "./history";
import { answerQuestion, type IntentMode } from "./agent";
import { recordCacheHit, recordCacheMiss } from "./metrics";

export interface ChatResponse {
  answer: string;
  cached: boolean;
  intent?: string;
  mode: IntentMode;
  score?: number; // cache similarity on a hit
  intentScore?: number; // router confidence on a miss (router mode)
  routed?: boolean;
  toolsUsed?: string[];
}

/**
 * Full request pipeline shared by /api/chat and the integration test:
 * semantic cache lookup (patient-scoped) → agent (intent → tools → grounded answer)
 * → cache write (volatile-skip) → conversation history → metrics.
 */
export async function handleChat(params: {
  patientId: string;
  question: string;
  mode?: IntentMode;
}): Promise<ChatResponse> {
  const { patientId, question } = params;
  const mode: IntentMode = params.mode ?? config.agent.intentMode;
  const cache = await getCache();

  // 1. Semantic cache lookup (patient-scoped)
  const hit = await cache.lookupForPatient({ question, patientId });
  if (hit) {
    await recordCacheHit(hit.answer);
    await appendTurn(patientId, "human", question);
    await appendTurn(patientId, "ai", hit.answer);
    return { answer: hit.answer, cached: true, intent: hit.intent, mode, score: hit.score };
  }

  // 2. Miss → run the agent grounded in this patient's data
  await recordCacheMiss();
  const history = await getTurns(patientId);
  const result = await answerQuestion(patientId, question, history, mode);

  // 3. Store in cache (volatile intents are skipped) + append history
  await cache.storeForPatient({
    question,
    patientId,
    answer: result.answer,
    intent: result.intent,
  });
  await appendTurn(patientId, "human", question);
  await appendTurn(patientId, "ai", result.answer);

  return {
    answer: result.answer,
    cached: false,
    intent: result.intent,
    mode: result.mode,
    intentScore: result.intentScore,
    routed: result.routed,
    toolsUsed: result.toolsUsed,
  };
}
