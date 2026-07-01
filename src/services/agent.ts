import { config } from "../config";
import { groveRespond, groveText, type GroveTool } from "../lib/grove";
import { TOOL_SCHEMAS, executeTool } from "./tools";
import { ARG_REQUIRED_INTENTS, ROUTER_CONFIDENCE_THRESHOLD, classifyIntent } from "./intents";
import type { ChatTurn } from "./history";

const SYSTEM_INSTRUCTIONS = `You are a helpful assistant for a health-insurance member.
You answer questions about the member's own claims, prescriptions, insurance coverage, deductible, and providers.
Rules:
- Ground every statement in the data provided (tool results). Never invent numbers, amounts, dates, drug names, or statuses.
- If the data shows nothing relevant, say so plainly.
- Be concise and clear. Use dollar amounts and plain language.
- You are not a doctor. Do not give medical advice; for clinical questions add a brief reminder to consult a healthcare professional.
- Only discuss THIS member's data.`;

const MAX_STEPS = 5;

export type IntentMode = "llm" | "router";

export interface AgentResult {
  answer: string;
  intent?: string;
  toolsUsed: string[];
  mode: IntentMode;
  intentScore?: number;
  routed: boolean; // true if the vector router (not the LLM) selected the tool
}

function safeParseArgs(raw?: string): Record<string, any> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function historyToInput(history: ChatTurn[]): any[] {
  return history.slice(-6).map((t) => ({
    role: t.role === "human" ? "user" : "assistant",
    content: t.content,
  }));
}

/** LLM tool-calling loop (Grove Responses API). The model selects and fills tools. */
async function runLlmToolCalling(
  patientId: string,
  question: string,
  history: ChatTurn[],
): Promise<{ answer: string; toolsUsed: string[] }> {
  const input: any[] = [...historyToInput(history), { role: "user", content: question }];
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
  return { answer: answer || "I couldn't produce an answer for that.", toolsUsed };
}

/** Single-call synthesis: the router already picked the tool, we just ground an answer. */
async function synthesizeFromData(
  question: string,
  intent: string,
  data: unknown,
  history: ChatTurn[],
): Promise<string> {
  const input: any[] = [
    ...historyToInput(history),
    { role: "user", content: question },
    { role: "user", content: `DATA (from ${intent}) for the current member:\n${JSON.stringify(data)}` },
  ];
  const resp = await groveRespond({ input, instructions: SYSTEM_INSTRUCTIONS });
  return groveText(resp) || "I couldn't produce an answer for that.";
}

/**
 * Entry point. In "router" mode, a MongoDB vector search classifies the intent and
 * (when confident) directly executes the mapped tool + a single synthesis call.
 * Low confidence or arg-requiring intents fall back to full LLM tool-calling.
 */
export async function answerQuestion(
  patientId: string,
  question: string,
  history: ChatTurn[] = [],
  mode: IntentMode = config.agent.intentMode,
): Promise<AgentResult> {
  if (mode === "router") {
    const match = await classifyIntent(question);
    const confident = match && match.score >= ROUTER_CONFIDENCE_THRESHOLD;
    const routable = confident && !ARG_REQUIRED_INTENTS.has(match!.intent);

    if (routable) {
      const data = await executeTool(match!.intent, patientId, {});
      const answer = await synthesizeFromData(question, match!.intent, data, history);
      return {
        answer,
        intent: match!.intent,
        toolsUsed: [match!.intent],
        mode: "router",
        intentScore: match!.score,
        routed: true,
      };
    }

    // Low confidence / arg-required → fall back to LLM tool-calling.
    const { answer, toolsUsed } = await runLlmToolCalling(patientId, question, history);
    return {
      answer,
      intent: toolsUsed[0],
      toolsUsed,
      mode: "router",
      intentScore: match?.score,
      routed: false,
    };
  }

  // LLM mode
  const { answer, toolsUsed } = await runLlmToolCalling(patientId, question, history);
  return { answer, intent: toolsUsed[0], toolsUsed, mode: "llm", routed: false };
}
