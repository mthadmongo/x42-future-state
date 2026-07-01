import { config } from "../src/config";
import { getDb, closeClient } from "../src/lib/mongo";
import { groveRespond, groveText } from "../src/lib/grove";
import { embedOne } from "../src/lib/voyage";

type Check = { name: string; ok: boolean; detail: string };

async function checkMongo(): Promise<Check> {
  try {
    const db = await getDb();
    const cols = await db.listCollections().toArray();
    return {
      name: "MongoDB",
      ok: true,
      detail: `connected to "${config.mongo.db}" — ${cols.length} collection(s): [${cols
        .map((c) => c.name)
        .join(", ")}]`,
    };
  } catch (err) {
    return { name: "MongoDB", ok: false, detail: (err as Error).message };
  }
}

async function checkGrove(): Promise<Check> {
  try {
    const resp = await groveRespond({ input: "Reply with exactly: OK" });
    const text = groveText(resp);
    return {
      name: "Grove LLM",
      ok: text.length > 0,
      detail: `model=${resp.model} status=${resp.status} text="${text.slice(0, 40)}"`,
    };
  } catch (err) {
    return { name: "Grove LLM", ok: false, detail: (err as Error).message };
  }
}

async function checkVoyage(): Promise<Check> {
  try {
    const vec = await embedOne("healthcheck test string");
    const ok = vec.length === config.voyage.dimensions;
    return {
      name: "Voyage embeddings",
      ok,
      detail: ok
        ? `model=${config.voyage.model} dims=${vec.length}`
        : `expected ${config.voyage.dimensions} dims, got ${vec.length}`,
    };
  } catch (err) {
    return { name: "Voyage embeddings", ok: false, detail: (err as Error).message };
  }
}

async function main() {
  console.log("=== Phase 0 healthcheck ===\n");
  const checks = [await checkMongo(), await checkGrove(), await checkVoyage()];

  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  }

  await closeClient();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((c) => c.name).join(", ")}`);
    process.exitCode = 1;
  }
}

main();
