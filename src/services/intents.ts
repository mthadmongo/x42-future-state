import type { Document } from "mongodb";
import { COLLECTIONS, VECTOR_FIELDS, VECTOR_INDEXES, config } from "../config";
import { getDb } from "../lib/mongo";
import { embeddings } from "../lib/embeddings";
import { Tracer, VECTOR_PLACEHOLDER } from "../lib/trace";

/**
 * Labeled example utterances per intent. Each intent maps to a tool name in
 * src/services/tools.ts. The router embeds these and classifies incoming
 * questions by nearest-neighbor vector search.
 */
export const INTENT_EXAMPLES: Record<string, string[]> = {
  getClaims: [
    "show me my claims",
    "what claims do I have",
    "list my recent claims",
    "have my claims been paid",
    "do I have any denied claims",
    "which claims are still pending",
  ],
  getClaimStatus: [
    "what is the status of claim clm_000123",
    "is claim clm_000045 approved or denied",
    "check the status of a specific claim by id",
  ],
  getCoverageSummary: [
    "what insurance plan am I on",
    "what are my copays",
    "tell me about my insurance coverage",
    "what is my specialist copay",
    "what type of plan do I have",
  ],
  getDeductibleStatus: [
    "how much of my deductible have I met",
    "how much deductible do I have left",
    "what is my out of pocket so far",
    "how close am I to my out of pocket maximum",
    "deductible remaining this year",
  ],
  getPrescriptions: [
    "what medications am I taking",
    "list my prescriptions",
    "what drugs am I on",
    "how many prescriptions do I have",
    "show my active medications",
  ],
  getRefillInfo: [
    "how many refills do I have left",
    "when was my prescription last filled",
    "which pharmacy fills my medications",
    "refills remaining on my medication",
    "can I refill my prescription",
  ],
  getProviderInfo: [
    "who is my doctor",
    "who is my primary care provider",
    "which cardiologist did I see",
    "list my providers",
    "what is my doctor's phone number",
  ],
  generalHealthEducation: [
    "what is a deductible",
    "what does copay mean",
    "how does coinsurance work",
    "what is a formulary",
    "explain out of pocket maximum",
  ],
};

/** Tools that require arguments the router can't extract → force LLM fallback. */
export const ARG_REQUIRED_INTENTS = new Set(["getClaimStatus"]);

export interface IntentMatch {
  intent: string;
  score: number;
}

/** Embeds all example utterances and (re)loads the intents collection. */
export async function seedIntents(): Promise<number> {
  const db = await getDb();
  const col = db.collection(COLLECTIONS.intents);
  await col.deleteMany({});

  const docs: Document[] = [];
  for (const [intent, examples] of Object.entries(INTENT_EXAMPLES)) {
    const vectors = await embeddings.embedDocuments(examples);
    examples.forEach((text, i) => {
      docs.push({ intent, text, [VECTOR_FIELDS.intents]: vectors[i] });
    });
  }
  await col.insertMany(docs);
  return docs.length;
}

/** Classifies a question to its nearest intent via vector search. */
export async function classifyIntent(question: string, tracer?: Tracer): Promise<IntentMatch | null> {
  const db = await getDb();
  tracer?.embedding(
    "Embed the question for intent routing",
    `${config.voyage.model} → ${config.voyage.dimensions}-dim vector`,
  );
  const queryVector = await embeddings.embedQuery(question);

  const tracedPipeline = [
    {
      $vectorSearch: {
        index: VECTOR_INDEXES.intents,
        path: VECTOR_FIELDS.intents,
        queryVector: VECTOR_PLACEHOLDER,
        numCandidates: 100,
        limit: 1,
      },
    },
    { $project: { intent: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
  ];
  tracer?.mongo(
    { collection: COLLECTIONS.intents, operation: "aggregate", query: tracedPipeline },
    "Vector search on intents (nearest labeled utterance)",
  );

  const [match] = await db
    .collection(COLLECTIONS.intents)
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEXES.intents,
          path: VECTOR_FIELDS.intents,
          queryVector,
          numCandidates: 100,
          limit: 1,
        },
      },
      { $project: { intent: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
    ])
    .toArray();

  if (!match) return null;
  return { intent: match.intent as string, score: match.score as number };
}

export const ROUTER_CONFIDENCE_THRESHOLD = config.agent.routerConfidenceThreshold;
