import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";

const DOC_ID = "global";

export interface Metrics {
  hits: number;
  misses: number;
  total: number;
  hitRate: number; // 0..1
  estTokensSaved: number;
}

/** Rough token estimate for a served-from-cache answer (chars/4 + prompt overhead). */
function estimateTokens(answer: string): number {
  return Math.ceil(answer.length / 4) + 250;
}

export async function recordCacheHit(answer: string): Promise<void> {
  const db = await getDb();
  await db
    .collection(COLLECTIONS.metrics)
    .updateOne(
      { _id: DOC_ID as any },
      { $inc: { hits: 1, estTokensSaved: estimateTokens(answer) } },
      { upsert: true },
    );
}

export async function recordCacheMiss(): Promise<void> {
  const db = await getDb();
  await db
    .collection(COLLECTIONS.metrics)
    .updateOne({ _id: DOC_ID as any }, { $inc: { misses: 1 } }, { upsert: true });
}

export async function getMetrics(): Promise<Metrics> {
  const db = await getDb();
  const doc = (await db.collection(COLLECTIONS.metrics).findOne({ _id: DOC_ID as any })) as any;
  const hits = doc?.hits ?? 0;
  const misses = doc?.misses ?? 0;
  const total = hits + misses;
  return {
    hits,
    misses,
    total,
    hitRate: total > 0 ? hits / total : 0,
    estTokensSaved: doc?.estTokensSaved ?? 0,
  };
}

export async function resetMetrics(): Promise<void> {
  const db = await getDb();
  await db
    .collection(COLLECTIONS.metrics)
    .updateOne(
      { _id: DOC_ID as any },
      { $set: { hits: 0, misses: 0, estTokensSaved: 0 } },
      { upsert: true },
    );
}
