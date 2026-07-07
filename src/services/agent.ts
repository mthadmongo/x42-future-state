import { config } from "../config";
import { groveRespond, groveText, type GroveTool } from "../lib/grove";
import { TOOL_SCHEMAS, executeTool } from "./tools";
import { ROUTER_CONFIDENCE_THRESHOLD, classifyIntent } from "./intents";
import { runToolChain } from "./toolChain";
import { extractParams } from "./params";
import type { ChatTurn } from "./history";
import type { Tracer } from "../lib/trace";

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
  instructions: string,
  tracer?: Tracer,
): Promise<{ answer: string; toolsUsed: string[] }> {
  const input: any[] = [...historyToInput(history), { role: "user", content: question }];
  const tools: GroveTool[] = TOOL_SCHEMAS;
  const toolsUsed: string[] = [];
  let answer = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    tracer?.llm(
      `LLM call (tool-calling), Grove ${config.grove.model}`,
      `${tools.length} tools offered, tool_choice=auto`,
    );
    const resp = await groveRespond({ input, tools, toolChoice: "auto", instructions });
    const calls = resp.output.filter((o) => o.type === "function_call");
    if (calls.length === 0) {
      answer = groveText(resp);
      tracer?.llm("LLM produced the final grounded answer");
      break;
    }
    tracer?.decision(`LLM selected tool(s): ${calls.map((c) => c.name).join(", ")}`);
    for (const call of calls) {
      const args = safeParseArgs(call.arguments);
      const result = await executeTool(call.name!, patientId, args, tracer);
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
  instructions: string,
  tracer?: Tracer,
): Promise<string> {
  const input: any[] = [
    ...historyToInput(history),
    { role: "user", content: question },
    { role: "user", content: `DATA (from ${intent}) for the current member:\n${JSON.stringify(data)}` },
  ];
  tracer?.llm(
    `LLM synthesis, Grove ${config.grove.model}`,
    "no tools — answer grounded in the routed tool's data",
  );
  const resp = await groveRespond({ input, instructions });
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
  tracer?: Tracer,
  memoryContext = "",
): Promise<AgentResult> {
  const instructions = memoryContext
    ? `${SYSTEM_INSTRUCTIONS}\n\n${memoryContext}`
    : SYSTEM_INSTRUCTIONS;

  if (mode === "router") {
    tracer?.info("Intent mode = router", "classify intent, then run its deterministic tool chain");
    const match = await classifyIntent(question, tracer);
    const confident = match && match.score >= ROUTER_CONFIDENCE_THRESHOLD;

    if (confident) {
      tracer?.decision(
        `Routed to "${match!.intent}"`,
        `score ${match!.score.toFixed(3)} ≥ ${ROUTER_CONFIDENCE_THRESHOLD}; running its predefined tool chain`,
      );
      // Fill any tool params from the question (skips the LLM when none are needed).
      const params = await extractParams(match!.intent, question, tracer);
      // Execute the intent's fixed tool chain deterministically (no LLM tool-selection).
      const chain = await runToolChain(match!.intent, patientId, params, tracer);
      const answer = await synthesizeFromData(question, match!.intent, chain.data, history, instructions, tracer);
      return {
        answer,
        intent: match!.intent,
        toolsUsed: chain.toolsRun,
        mode: "router",
        intentScore: match!.score,
        routed: true,
      };
    }

    // Low confidence → fall back to LLM tool-calling.
    tracer?.decision(
      "Router not confident enough → fall back to LLM tool-calling",
      match
        ? `top intent "${match.intent}" scored ${match.score.toFixed(3)} (< ${ROUTER_CONFIDENCE_THRESHOLD})`
        : "no intent match",
    );
    const { answer, toolsUsed } = await runLlmToolCalling(patientId, question, history, instructions, tracer);
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
  tracer?.info("Intent mode = LLM tool-calling", "the model chooses which tools to call");
  const { answer, toolsUsed } = await runLlmToolCalling(patientId, question, history, instructions, tracer);
  return { answer, intent: toolsUsed[0], toolsUsed, mode: "llm", routed: false };
}
