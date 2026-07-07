import { config } from "../config";
import { groveRespond, groveText } from "../lib/grove";
import { getToolDef, toolsForIntent } from "./toolRegistry";
import type { Tracer } from "../lib/trace";

type ParamSchema = Record<string, { type: string; required: boolean; description: string }>;

/** Union of all params required/accepted by the tools in an intent's chain. */
async function paramSchemaForIntent(intent: string): Promise<ParamSchema> {
  const schema: ParamSchema = {};
  for (const toolName of toolsForIntent(intent)) {
    const def = await getToolDef(toolName);
    if (def?.params) Object.assign(schema, def.params);
  }
  return schema;
}

/**
 * Small, constrained LLM call that extracts tool parameters (e.g. claimId, drugName)
 * from the question. Returns only params that are present; absent ones are omitted.
 * Skips the LLM entirely when the intent's chain needs no params.
 */
export async function extractParams(
  intent: string,
  question: string,
  tracer?: Tracer,
): Promise<Record<string, any>> {
  const schema = await paramSchemaForIntent(intent);
  const keys = Object.keys(schema);
  if (keys.length === 0) return {};

  const descriptions = keys.map((k) => `- ${k} (${schema[k].type}${schema[k].required ? ", required" : ", optional"}): ${schema[k].description}`).join("\n");
  const instructions =
    "Extract the following parameters from the user's question for a health-insurance assistant. " +
    "Return ONLY minified JSON with a key per parameter; use null if the parameter is not present in the question. Do not invent values.\n" +
    `Parameters:\n${descriptions}`;

  tracer?.llm(`Parameter extraction (LLM), Grove ${config.grove.model}`, `params: ${keys.join(", ")}`);
  const resp = await groveRespond({ input: [{ role: "user", content: question }], instructions });
  const text = groveText(resp).trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  const out: Record<string, any> = {};
  for (const k of keys) {
    if (parsed[k] !== null && parsed[k] !== undefined && parsed[k] !== "") out[k] = parsed[k];
  }
  tracer?.decision(
    Object.keys(out).length ? `Extracted params: ${JSON.stringify(out)}` : "No parameters found in the question",
  );
  return out;
}
