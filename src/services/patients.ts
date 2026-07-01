import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";
import type { Coverage, Patient } from "../types";

export interface PatientSummary {
  id: string;
  name: string;
  dob: string;
  sex: string;
  memberId: string;
  planName: string;
}

export async function listPatients(): Promise<PatientSummary[]> {
  const db = await getDb();
  const patients = await db
    .collection<Patient>(COLLECTIONS.patients)
    .find()
    .sort({ "name.last": 1 })
    .toArray();
  const coverage = await db.collection<Coverage>(COLLECTIONS.coverage).find().toArray();
  const covByPatient = new Map(coverage.map((c) => [c.patientId, c]));

  return patients.map((p) => ({
    id: p._id,
    name: `${p.name.first} ${p.name.last}`,
    dob: p.dob,
    sex: p.sex,
    memberId: p.memberId,
    planName: covByPatient.get(p._id)?.planName ?? "Unknown plan",
  }));
}

export async function getPatient(patientId: string): Promise<Patient | null> {
  const db = await getDb();
  return db.collection<Patient>(COLLECTIONS.patients).findOne({ _id: patientId } as any);
}
