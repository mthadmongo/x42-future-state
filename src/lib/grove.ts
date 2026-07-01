import { config } from "../config";

export interface GroveTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface GroveOutputItem {
  type: string;
  // message items
  content?: Array<{ type: string; text?: string }>;
  // function_call items
  name?: string;
  arguments?: string;
  call_id?: string;
}

export interface GroveResponse {
  id: string;
  status: string;
  model: string;
  output: GroveOutputItem[];
  error?: unknown;
}

/**
 * Calls the Grove gateway (OpenAI Responses API). Grove only exposes /responses
 * and authenticates via the `api-key` header (not `Authorization: Bearer`).
 */
export async function groveRespond(params: {
  input: unknown;
  tools?: GroveTool[];
  toolChoice?: "auto" | "none" | "required";
  instructions?: string;
}): Promise<GroveResponse> {
  const body: Record<string, unknown> = {
    model: config.grove.model,
    input: params.input,
  };
  if (params.tools) body.tools = params.tools;
  if (params.toolChoice) body.tool_choice = params.toolChoice;
  if (params.instructions) body.instructions = params.instructions;

  const res = await fetch(`${config.grove.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.grove.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grove request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return (await res.json()) as GroveResponse;
}

/** Convenience: extract the concatenated assistant text from a Grove response. */
export function groveText(resp: GroveResponse): string {
  return resp.output
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text" || c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
}
