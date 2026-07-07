import type { Document } from "mongodb";
import { COLLECTIONS, VECTOR_FIELDS, VECTOR_INDEXES, config } from "../config";
import { getDb } from "../lib/mongo";
import { embeddings } from "../lib/embeddings";
import { groveRespond, groveText } from "../lib/grove";
import { Tracer, VECTOR_PLACEHOLDER } from "../lib/trace";
import type { ChatTurn } from "./history";

export type MemoryType = "preference" | "fact" | "summary";

export interface MemoryItem {
  type: MemoryType;
  text: string;
  score?: number;
}

const TOP_K = config.memory.topK;
const DEDUPE = config.memory.dedupeThreshold;

/**
 * LONG-TERM MEMORY (per patient, cross-conversation): durable preferences, stable
 * facts, and per-conversation summaries — vector-searchable and pre-filtered by
 * patientId (same isolation model as the semantic cache). This is NOT a place for
 * volatile figures (deductible met, refill counts) — those always come from tools.
 */

/** Recall the top-K memories most relevant to the current question, for THIS patient only. */
export async function recallMemories(
  patientId: string,
  query: string,
  tracer?: Tracer,
): Promise<MemoryItem[]> {
  const db = await getDb();
  tracer?.embedding("Embed the question for memory recall", `${config.voyage.model} → ${config.voyage.dimensions}-dim`);
  const queryVector = await embeddings.embedQuery(query);

  const tracedPipeline = [
    {
      $vectorSearch: {
        index: VECTOR_INDEXES.agentMemory,
        path: VECTOR_FIELDS.agentMemory,
        queryVector: VECTOR_PLACEHOLDER,
        filter: { patientId },
        numCandidates: 100,
        limit: TOP_K,
      },
    },
    { $project: { type: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
  ];
  tracer?.mongo(
    { collection: COLLECTIONS.agentMemory, operation: "aggregate", query: tracedPipeline },
    "Recall long-term memory (vector search on agent_memory, pre-filtered by patientId)",
  );

  const rows = await db
    .collection(COLLECTIONS.agentMemory)
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEXES.agentMemory,
          path: VECTOR_FIELDS.agentMemory,
          queryVector,
          filter: { patientId },
          numCandidates: 100,
          limit: TOP_K,
        },
      },
      { $project: { type: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
    ])
    .toArray();

  tracer?.decision(
    rows.length ? `Recalled ${rows.length} memory item(s)` : "No long-term memory yet for this patient",
    rows.map((r) => `${r.type}: ${r.text}`).join(" | ") || undefined,
  );

  return rows.map((r) => ({ type: r.type as MemoryType, text: r.text as string, score: r.score as number }));
}

interface ExtractionResult {
  preferences: string[];
  facts: string[];
  summary: string;
}

const EXTRACTOR_INSTRUCTIONS = `You maintain long-term memory about a health-insurance member from their chat.
From the latest exchange, extract ONLY durable, reusable information:
- "preferences": stable choices/likes (e.g., prefers generic drugs, mail-order pharmacy, simple explanations, a language).
- "facts": stable personal context (e.g., a caregiver manages their care, they travel often, an ongoing concern).
- "summary": a concise, updated running summary of the whole conversation (1-3 sentences).

STRICT RULES:
- NEVER record volatile/derived figures that change over time (deductible met, out-of-pocket, refill counts, claim counts, balances, specific dollar amounts, dates). Those are always looked up live.
- Only include preferences/facts that are genuinely durable and worth remembering next time. If none, use empty arrays.
- Keep each item short (one clause).
- Respond with ONLY minified JSON: {"preferences":[],"facts":[],"summary":""}`;

async function extract(
  question: string,
  answer: string,
  history: ChatTurn[],
  priorSummary: string,
): Promise<ExtractionResult> {
  const recent = history.slice(-4).map((t) => `${t.role}: ${t.content}`).join("\n");
  const input = [
    {
      role: "user",
      content:
        `Prior summary: ${priorSummary || "(none)"}\n\n` +
        `Recent turns:\n${recent || "(none)"}\n\n` +
        `Latest exchange:\nuser: ${question}\nassistant: ${answer}`,
    },
  ];
  const resp = await groveRespond({ input, instructions: EXTRACTOR_INSTRUCTIONS });
  const text = groveText(resp).trim();
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      preferences: Array.isArray(parsed.preferences) ? parsed.preferences.filter((s: unknown) => typeof s === "string") : [],
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter((s: unknown) => typeof s === "string") : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch {
    return { preferences: [], facts: [], summary: priorSummary };
  }
}

/** Insert a preference/fact, or update the nearest existing one if it's a near-duplicate. */
async function upsertItem(patientId: string, type: MemoryType, text: string, conversationId: string, tracer?: Tracer) {
  const db = await getDb();
  const col = db.collection(COLLECTIONS.agentMemory);
  const embedding = await embeddings.embedQuery(text);

  const [near] = await col
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEXES.agentMemory,
          path: VECTOR_FIELDS.agentMemory,
          queryVector: embedding,
          filter: { patientId, type },
          numCandidates: 50,
          limit: 1,
        },
      },
      { $project: { text: 1, score: { $meta: "vectorSearchScore" } } },
    ])
    .toArray();

  const now = new Date();
  if (near && (near.score as number) >= DEDUPE) {
    tracer?.mongo(
      { collection: COLLECTIONS.agentMemory, operation: "updateOne", query: { _id: String(near._id), $set: { text } } },
      `Update existing ${type} memory (near-duplicate, score ${(near.score as number).toFixed(3)})`,
    );
    await col.updateOne(
      { _id: near._id },
      { $set: { text, embedding, updatedAt: now }, $inc: { confidence: 1 } },
    );
    return;
  }

  const doc: Document = {
    patientId,
    type,
    text,
    embedding,
    conversationId,
    confidence: 1,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  };
  tracer?.mongo(
    { collection: COLLECTIONS.agentMemory, operation: "insertOne", query: { ...doc, embedding: VECTOR_PLACEHOLDER } },
    `Write new ${type} to long-term memory`,
  );
  await col.insertOne(doc);
}

async function getConversationSummaryText(patientId: string, conversationId: string): Promise<string> {
  const db = await getDb();
  const doc = await db
    .collection(COLLECTIONS.agentMemory)
    .findOne({ patientId, conversationId, type: "summary" } as any);
  return (doc?.text as string) ?? "";
}

async function upsertConversationSummary(patientId: string, conversationId: string, summary: string, tracer?: Tracer) {
  if (!summary.trim()) return;
  const db = await getDb();
  const col = db.collection(COLLECTIONS.agentMemory);
  const embedding = await embeddings.embedQuery(summary);
  const now = new Date();
  tracer?.mongo(
    { collection: COLLECTIONS.agentMemory, operation: "updateOne", query: { patientId, conversationId, type: "summary", upsert: true } },
    "Update rolling conversation summary",
  );
  await col.updateOne(
    { patientId, conversationId, type: "summary" } as any,
    { $set: { text: summary, embedding, updatedAt: now }, $setOnInsert: { createdAt: now, confidence: 1 } },
    { upsert: true },
  );
}

/**
 * Memory formation: after an answer is GENERATED (not on cache hits), extract durable
 * preferences/facts and refresh the conversation summary, then upsert them.
 */
export async function formMemories(params: {
  patientId: string;
  conversationId: string;
  question: string;
  answer: string;
  history: ChatTurn[];
  tracer?: Tracer;
}): Promise<{ preferences: number; facts: number; summarized: boolean }> {
  const { patientId, conversationId, question, answer, history, tracer } = params;
  const priorSummary = await getConversationSummaryText(patientId, conversationId);

  tracer?.llm(`Memory extraction (LLM), Grove ${config.grove.model}`, "extract durable preferences/facts + refresh summary");
  const extracted = await extract(question, answer, history, priorSummary);

  for (const pref of extracted.preferences) await upsertItem(patientId, "preference", pref, conversationId, tracer);
  for (const fact of extracted.facts) await upsertItem(patientId, "fact", fact, conversationId, tracer);
  await upsertConversationSummary(patientId, conversationId, extracted.summary, tracer);

  if (extracted.preferences.length === 0 && extracted.facts.length === 0) {
    tracer?.decision("No new durable preferences/facts to remember from this turn");
  }

  return {
    preferences: extracted.preferences.length,
    facts: extracted.facts.length,
    summarized: Boolean(extracted.summary.trim()),
  };
}

/** Formats recalled memories for injection into the agent's system prompt. */
export function formatMemoriesForPrompt(memories: MemoryItem[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) => `- (${m.type}) ${m.text}`);
  return `What you already know about this member (long-term memory):\n${lines.join("\n")}`;
}
