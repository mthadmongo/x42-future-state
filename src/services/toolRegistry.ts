import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";
import { INTENT_TOOLS, TOOL_REGISTRY, type ToolDef } from "../data/toolDefs";

let cache: Map<string, ToolDef> | null = null;

/** (Re)load the `tools` collection from the registry definitions. */
export async function seedTools(): Promise<number> {
  const db = await getDb();
  const col = db.collection(COLLECTIONS.tools);
  await col.deleteMany({});
  await col.insertMany(TOOL_REGISTRY.map((t) => ({ _id: t.name as any, ...t })));
  cache = null;
  return TOOL_REGISTRY.length;
}

/** Load all tool definitions from MongoDB (cached in-process). */
export async function loadToolDefs(): Promise<Map<string, ToolDef>> {
  if (cache) return cache;
  const db = await getDb();
  const docs = await db.collection(COLLECTIONS.tools).find().toArray();
  cache = new Map(docs.map((d) => [d.name as string, d as unknown as ToolDef]));
  return cache;
}

export async function getToolDef(name: string): Promise<ToolDef | undefined> {
  return (await loadToolDefs()).get(name);
}

export function toolsForIntent(intent: string): string[] {
  return INTENT_TOOLS[intent] ?? [];
}
