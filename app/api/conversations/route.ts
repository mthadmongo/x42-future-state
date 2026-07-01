import { NextRequest, NextResponse } from "next/server";
import { createConversation, listConversations } from "../../../src/services/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }
  const conversations = await listConversations(patientId);
  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const { patientId } = await req.json();
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }
  const conversation = await createConversation(patientId);
  return NextResponse.json({ conversation });
}
