import { NextRequest, NextResponse } from "next/server";
import { appendTurn } from "../../../src/services/history";

export const dynamic = "force-dynamic";

// NOTE: Phase 3 placeholder. Phase 5 replaces this with the semantic-cache →
// intent → tools → Grove orchestration pipeline.
export async function POST(req: NextRequest) {
  const { patientId, question } = await req.json();
  if (!patientId || !question) {
    return NextResponse.json({ error: "patientId and question are required" }, { status: 400 });
  }
  await appendTurn(patientId, "human", question);
  const answer = "(Agent pipeline is wired up in Phase 5.)";
  await appendTurn(patientId, "ai", answer);
  return NextResponse.json({ answer, cached: false });
}
