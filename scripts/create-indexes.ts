import { COLLECTIONS, VECTOR_FIELDS, VECTOR_INDEXES, config } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";

const DIMS = config.voyage.dimensions;

const indexSpecs = [
  {
    collection: COLLECTIONS.semanticCache,
    name: VECTOR_INDEXES.semanticCache,
    definition: {
      fields: [
        { type: "vector", path: VECTOR_FIELDS.semanticCache, numDimensions: DIMS, similarity: "cosine" },
        { type: "filter", path: "patientId" },
        { type: "filter", path: "embeddingModel" },
        { type: "filter", path: "scope" },
      ],
    },
  },
  {
    collection: COLLECTIONS.intents,
    name: VECTOR_INDEXES.intents,
    definition: {
      fields: [{ type: "vector", path: VECTOR_FIELDS.intents, numDimensions: DIMS, similarity: "cosine" }],
    },
  },
];

async function ensureCollection(name: string) {
  const db = await getDb();
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name);
    console.log(`  created collection "${name}"`);
  }
}

async function main() {
  console.log("=== Phase 2 create-indexes ===\n");
  const db = await getDb();

  for (const spec of indexSpecs) {
    await ensureCollection(spec.collection);
    const col = db.collection(spec.collection);
    const existing = await col.listSearchIndexes().toArray();
    if (existing.some((idx) => idx.name === spec.name)) {
      console.log(`  index "${spec.name}" on ${spec.collection} already exists — skipping create`);
      continue;
    }
    await col.createSearchIndex({
      name: spec.name,
      type: "vectorSearch",
      definition: spec.definition,
    });
    console.log(`  requested vectorSearch index "${spec.name}" on ${spec.collection}`);
  }

  // Poll until all indexes report queryable
  console.log("\nWaiting for indexes to become queryable...");
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const statuses: string[] = [];
    let allReady = true;
    for (const spec of indexSpecs) {
      const idx = (await db.collection(spec.collection).listSearchIndexes().toArray()).find(
        (i: any) => i.name === spec.name,
      ) as any;
      const status = idx?.status ?? "MISSING";
      const queryable = idx?.queryable === true;
      statuses.push(`${spec.name}=${status}${queryable ? " (queryable)" : ""}`);
      if (!queryable) allReady = false;
    }
    console.log(`  ${statuses.join(" | ")}`);
    if (allReady) {
      console.log("\nAll vector search indexes are queryable.");
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  await closeClient();
}

main().catch(async (err) => {
  console.error("create-indexes failed:", err);
  await closeClient();
  process.exit(1);
});
