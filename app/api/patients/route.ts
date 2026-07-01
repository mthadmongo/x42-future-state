import { NextResponse } from "next/server";
import { listPatients } from "../../../src/services/patients";

export const dynamic = "force-dynamic";

export async function GET() {
  const patients = await listPatients();
  return NextResponse.json({ patients });
}
