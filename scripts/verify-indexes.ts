import { COLLECTIONS, VECTOR_FIELDS, VECTOR_INDEXES, config } from "../src/config.js";
import { getDb, closeClient } from "../src/lib/mongo.js";

const DIMS = config.voyage.dimensions;

/** Deterministic pseudo-random unit-ish vector (no Voyage needed for an index smoke test). */
function fakeVector(seed: number): number[] {
  const v: number[] = [];
  let x = seed;
  for (let i = 0; i < DIMS; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    v.push((x / 0x7fffffff) * 2 - 1);
  }
  return v;
}

async function main() {
  console.log("=== Phase 2 verify-indexes ===\n");
  const db = await getDb();
  const failures: string[] = [];
  const pass = (m: string) => console.log(`PASS  ${m}`);
  const fail = (m: string) => {
    console.log(`FAIL  ${m}`);
    failures.push(m);
  };

  // 1. Both indexes exist and are queryable
  for (const [name, idxName] of [
    [COLLECTIONS.semanticCache, VECTOR_INDEXES.semanticCache],
    [COLLECTIONS.intents, VECTOR_INDEXES.intents],
  ] as const) {
    const idx = (await db.collection(name).listSearchIndexes().toArray()).find((i) => i.name === idxName);
    idx?.queryable
      ? pass(`${idxName} on ${name} is queryable (status=${idx.status})`)
      : fail(`${idxName} on ${name} not queryable (status=${idx?.status ?? "MISSING"})`);
  }

  // 2. Insert dummy docs and run a PRE-FILTERED $vectorSearch on semantic_cache
  const cache = db.collection(COLLECTIONS.semanticCache);
  const testDocs = [
    { _id: "test_a", patientId: "pat_0001", scope: "patient", embeddingModel: config.voyage.model, queryEmbedding: fakeVector(1) },
    { _id: "test_b", patientId: "pat_0001", scope: "patient", embeddingModel: config.voyage.model, queryEmbedding: fakeVector(2) },
    { _id: "test_c", patientId: "pat_0002", scope: "patient", embeddingModel: config.voyage.model, queryEmbedding: fakeVector(3) },
  ];
  await cache.deleteMany({ _id: { $in: testDocs.map((d) => d._id) } as any });
  await cache.insertMany(testDocs as any[]);

  // Give the index a moment to pick up the new docs
  let results: any[] = [];
  for (let attempt = 0; attempt < 12; attempt++) {
    results = await cache
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEXES.semanticCache,
            path: VECTOR_FIELDS.semanticCache,
            queryVector: fakeVector(1),
            filter: { patientId: "pat_0001" },
            numCandidates: 50,
            limit: 5,
          },
        },
        { $project: { _id: 1, patientId: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    if (results.length > 0) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  results.length > 0
    ? pass(`pre-filtered $vectorSearch returned ${results.length} result(s); top score=${results[0].score?.toFixed(4)}`)
    : fail("pre-filtered $vectorSearch returned no results (index may still be indexing test docs)");

  const onlyPat1 = results.every((r) => r.patientId === "pat_0001");
  onlyPat1
    ? pass("pre-filter isolation: all results have patientId=pat_0001")
    : fail("pre-filter leaked other patients' documents");

  // Cleanup
  await cache.deleteMany({ _id: { $in: testDocs.map((d) => d._id) } as any });
  console.log("  cleaned up test docs");

  await closeClient();
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("verify-indexes failed:", err);
  await closeClient();
  process.exit(1);
});
