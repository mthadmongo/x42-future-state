import { NextRequest, NextResponse } from "next/server";
import { getTurns } from "../../../src/services/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }
  const turns = await getTurns(conversationId);
  return NextResponse.json({ turns });
}
