import { NextRequest, NextResponse } from "next/server";
import { getTurns } from "../../../src/services/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const patientId = req.nextUrl.searchParams.get("patientId");
  if (!patientId) {
    return NextResponse.json({ error: "patientId is required" }, { status: 400 });
  }
  const turns = await getTurns(patientId);
  return NextResponse.json({ turns });
}
