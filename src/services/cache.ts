import { MongoDBAtlasSemanticCache } from "@langchain/mongodb";
import type { Collection, Document } from "mongodb";
import { COLLECTIONS, VECTOR_FIELDS, VECTOR_INDEXES, config } from "../config";
import { getDb } from "../lib/mongo";
import { embeddings } from "../lib/embeddings";
import { Tracer, VECTOR_PLACEHOLDER } from "../lib/trace";

/** Intents whose answers embed fast-changing data — never cached (no TTL, per decision). */
export const VOLATILE_INTENTS = new Set(["getDeductibleStatus", "getRefillInfo", "getClaimStatus"]);

export interface CacheHit {
  answer: string;
  intent?: string;
  score: number;
  cachedQuestion: string;
}

export interface StoreResult {
  stored: boolean;
  reason?: "volatile";
}

/**
 * Plan A: subclass MongoDBAtlasSemanticCache to reuse its embedding + collection
 * plumbing, but add PATIENT-SCOPED, question-level lookup/store with a `patientId`
 * pre-filter. Called explicitly at the question boundary (not a global set_llm_cache),
 * so intent-routing LLM calls never pollute the patient cache.
 */
export class PatientSemanticCache extends MongoDBAtlasSemanticCache {
  private col: Collection<Document>;
  private threshold: number;
  private modelName: string;
  private idxName: string;

  constructor(collection: Collection<Document>) {
    super(collection, embeddings, {
      indexName: VECTOR_INDEXES.semanticCache,
      scoreThreshold: config.agent.cacheSimilarityThreshold,
    });
    this.col = collection;
    this.threshold = config.agent.cacheSimilarityThreshold;
    this.modelName = config.voyage.model;
    this.idxName = VECTOR_INDEXES.semanticCache;
  }

  /** Look up a semantically-similar prior answer for THIS patient only. */
  async lookupForPatient(
    params: {
      question: string;
      patientId: string;
      scope?: "patient" | "global";
    },
    tracer?: Tracer,
  ): Promise<CacheHit | null> {
    const scope = params.scope ?? "patient";
    // getEmbedding is the base-class plumbing — using it for both lookup and store
    // guarantees symmetric embedding.
    tracer?.embedding(
      "Embed the question (Atlas Embedding API)",
      `${this.modelName} → ${config.voyage.dimensions}-dim vector`,
    );
    const queryVector = await this.getEmbedding(params.question);

    const filter = { patientId: params.patientId, embeddingModel: this.modelName, scope };
    const tracedPipeline = [
      {
        $vectorSearch: {
          index: this.idxName,
          path: VECTOR_FIELDS.semanticCache,
          queryVector: VECTOR_PLACEHOLDER,
          filter,
          numCandidates: 50,
          limit: 1,
        },
      },
      { $project: { answer: 1, intent: 1, queryText: 1, score: { $meta: "vectorSearchScore" } } },
    ];
    tracer?.mongo(
      { collection: COLLECTIONS.semanticCache, operation: "aggregate", query: tracedPipeline },
      "Vector search on semantic_cache (pre-filtered by patientId)",
    );

    const [hit] = await this.col
      .aggregate([
        {
          $vectorSearch: {
            index: this.idxName,
            path: VECTOR_FIELDS.semanticCache,
            queryVector,
            filter,
            numCandidates: 50,
            limit: 1,
          },
        },
        {
          $project: {
            answer: 1,
            intent: 1,
            queryText: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();

    if (hit && hit.score >= this.threshold) {
      tracer?.decision(
        "Cache HIT — returning stored answer, skipping the LLM",
        `score ${(hit.score as number).toFixed(4)} ≥ threshold ${this.threshold}; matched "${hit.queryText}"`,
      );
      await this.col.updateOne(
        { _id: hit._id },
        { $inc: { hitCount: 1 }, $set: { lastAccessedAt: new Date() } },
      );
      return {
        answer: hit.answer as string,
        intent: hit.intent as string | undefined,
        score: hit.score as number,
        cachedQuestion: hit.queryText as string,
      };
    }
    tracer?.decision(
      "Cache MISS — will invoke the agent",
      hit
        ? `best score ${(hit.score as number).toFixed(4)} < threshold ${this.threshold}`
        : "no prior entries for this patient",
    );
    return null;
  }

  /** Store a Q&A for THIS patient, unless the intent is volatile. */
  async storeForPatient(
    params: {
      question: string;
      patientId: string;
      answer: string;
      intent?: string;
      scope?: "patient" | "global";
      sourceRefs?: string[];
    },
    tracer?: Tracer,
  ): Promise<StoreResult> {
    if (params.intent && VOLATILE_INTENTS.has(params.intent)) {
      tracer?.decision(
        "Skip cache write — volatile intent",
        `intent "${params.intent}" embeds fast-changing data, so it is never cached`,
      );
      return { stored: false, reason: "volatile" };
    }
    const scope = params.scope ?? "patient";
    const queryEmbedding = await this.getEmbedding(params.question);
    const now = new Date();

    const doc = {
      patientId: params.patientId,
      scope,
      queryText: params.question,
      queryEmbedding,
      embeddingModel: this.modelName,
      intent: params.intent ?? null,
      answer: params.answer,
      sourceRefs: params.sourceRefs ?? [],
      createdAt: now,
      lastAccessedAt: now,
      hitCount: 0,
    };
    tracer?.mongo(
      {
        collection: COLLECTIONS.semanticCache,
        operation: "insertOne",
        query: { ...doc, queryEmbedding: VECTOR_PLACEHOLDER },
      },
      "Write answer to semantic_cache",
      `scope=${scope}, intent=${params.intent ?? "null"}`,
    );
    await this.col.insertOne(doc as Document);

    return { stored: true };
  }
}

let cacheInstance: PatientSemanticCache | null = null;

export async function getCache(): Promise<PatientSemanticCache> {
  if (!cacheInstance) {
    const db = await getDb();
    cacheInstance = new PatientSemanticCache(db.collection(COLLECTIONS.semanticCache));
  }
  return cacheInstance;
}
