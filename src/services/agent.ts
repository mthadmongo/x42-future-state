import { groveRespond, groveText, type GroveTool } from "../lib/grove";
import { TOOL_SCHEMAS, executeTool } from "./tools";
import type { ChatTurn } from "./history";

const SYSTEM_INSTRUCTIONS = `You are a helpful assistant for a health-insurance member.
You answer questions about the member's own claims, prescriptions, insurance coverage, deductible, and providers.
Rules:
- ALWAYS use the provided tools to fetch the member's data. Never invent numbers, amounts, dates, drug names, or statuses.
- Ground every statement in tool results. If a tool returns no data, say so plainly.
- Be concise and clear. Use dollar amounts and plain language.
- You are not a doctor. Do not give medical advice; for clinical questions add a brief reminder to consult a healthcare professional.
- Only discuss THIS member's data.`;

const MAX_STEPS = 5;

function safeParseArgs(raw?: string): Record<string, any> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export interface AgentResult {
  answer: string;
  intent?: string;
  toolsUsed: string[];
}

/**
 * Runs the Grove (OpenAI Responses API) tool-calling loop for a single question.
 * All tool executions are scoped to `patientId` server-side.
 */
export async function answerQuestion(
  patientId: string,
  question: string,
  history: ChatTurn[] = [],
): Promise<AgentResult> {
  const input: any[] = [];
  for (const turn of history.slice(-6)) {
    input.push({ role: turn.role === "human" ? "user" : "assistant", content: turn.content });
  }
  input.push({ role: "user", content: question });

  const tools: GroveTool[] = TOOL_SCHEMAS;
  const toolsUsed: string[] = [];
  let answer = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await groveRespond({ input, tools, toolChoice: "auto", instructions: SYSTEM_INSTRUCTIONS });
    const calls = resp.output.filter((o) => o.type === "function_call");

    if (calls.length === 0) {
      answer = groveText(resp);
      break;
    }

    for (const call of calls) {
      const args = safeParseArgs(call.arguments);
      const result = await executeTool(call.name!, patientId, args);
      toolsUsed.push(call.name!);
      input.push({ type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments });
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }

  return {
    answer: answer || "I couldn't produce an answer for that.",
    intent: toolsUsed[0],
    toolsUsed,
  };
}
