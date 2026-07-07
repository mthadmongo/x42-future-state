import { config, COLLECTIONS } from "../config";
import { getCache } from "./cache";
import { getTurns, appendTurn } from "./history";
import { touchConversation } from "./conversations";
import { answerQuestion, type IntentMode } from "./agent";
import { recordCacheHit, recordCacheMiss } from "./metrics";
import { recallMemories, formMemories, formatMemoriesForPrompt } from "./memory";
import { Tracer, type TraceStep } from "../lib/trace";

export interface ChatResponse {
  answer: string;
  cached: boolean;
  conversationId: string;
  intent?: string;
  mode: IntentMode;
  score?: number; // cache similarity on a hit
  intentScore?: number; // router confidence on a miss (router mode)
  routed?: boolean;
  toolsUsed?: string[];
  trace: TraceStep[];
}

/**
 * Full request pipeline shared by /api/chat and the integration test:
 * semantic cache lookup (patient-scoped) → agent (intent → tools → grounded answer)
 * → cache write (volatile-skip) → conversation history → metrics.
 *
 * A Tracer records every reasoning step and MongoDB operation for the query panel.
 */
export async function handleChat(params: {
  patientId: string;
  conversationId: string;
  question: string;
  mode?: IntentMode;
}): Promise<ChatResponse> {
  const { patientId, conversationId, question } = params;
  const mode: IntentMode = params.mode ?? config.agent.intentMode;
  const tracer = new Tracer();
  tracer.info(
    "Received question",
    `patient=${patientId}, conversation=${conversationId.slice(0, 8)}…, mode=${mode}`,
  );

  const cache = await getCache();

  // 1. Semantic cache lookup (patient-scoped — shared across this patient's conversations)
  const hit = await cache.lookupForPatient({ question, patientId }, tracer);
  if (hit) {
    await recordCacheHit(hit.answer);
    tracer.mongo(
      { collection: COLLECTIONS.conversationMessages, operation: "insertMany", query: "2 messages (human + ai)" },
      "Append turn to conversation history",
    );
    await appendTurn(conversationId, "human", question);
    await appendTurn(conversationId, "ai", hit.answer);
    await touchConversation(conversationId, question);
    return {
      answer: hit.answer,
      cached: true,
      conversationId,
      intent: hit.intent,
      mode,
      score: hit.score,
      trace: tracer.steps,
    };
  }

  // 2. Miss → recall long-term memory, then run the agent grounded in this patient's data
  await recordCacheMiss();
  const history = await getTurns(conversationId);
  const memories = await recallMemories(patientId, question, tracer);
  const memoryContext = formatMemoriesForPrompt(memories);
  const result = await answerQuestion(patientId, question, history, mode, tracer, memoryContext);

  // 3. Store in cache (volatile intents are skipped) + append history
  await cache.storeForPatient(
    { question, patientId, answer: result.answer, intent: result.intent },
    tracer,
  );
  tracer.mongo(
    { collection: COLLECTIONS.conversationMessages, operation: "insertMany", query: "2 messages (human + ai)" },
    "Append turn to conversation history",
  );
  await appendTurn(conversationId, "human", question);
  await appendTurn(conversationId, "ai", result.answer);
  await touchConversation(conversationId, question);

  // 4. Memory formation — only on generated turns (skipped on cache hits)
  await formMemories({ patientId, conversationId, question, answer: result.answer, history, tracer });

  return {
    answer: result.answer,
    cached: false,
    conversationId,
    intent: result.intent,
    mode: result.mode,
    intentScore: result.intentScore,
    routed: result.routed,
    toolsUsed: result.toolsUsed,
    trace: tracer.steps,
  };
}
