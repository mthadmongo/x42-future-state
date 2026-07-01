import { NextRequest, NextResponse } from "next/server";
import { handleChat } from "../../../src/services/chat";
import type { IntentMode } from "../../../src/services/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { patientId, conversationId, question, mode } = await req.json();
  if (!patientId || !conversationId || !question) {
    return NextResponse.json(
      { error: "patientId, conversationId, and question are required" },
      { status: 400 },
    );
  }
  const result = await handleChat({
    patientId,
    conversationId,
    question,
    mode: mode === "router" || mode === "llm" ? (mode as IntentMode) : undefined,
  });
  return NextResponse.json(result);
}
