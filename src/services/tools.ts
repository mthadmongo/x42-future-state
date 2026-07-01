import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";
import type { GroveTool } from "../lib/grove";
import type { Tracer } from "../lib/trace";
import type { Claim, Coverage, Prescription, Provider } from "../types";

/**
 * Tool schemas advertised to the LLM. NOTE: none of these accept a patientId —
 * identity comes from the session and is injected server-side, so the model can
 * never request another patient's data.
 */
export const TOOL_SCHEMAS: GroveTool[] = [
  {
    type: "function",
    name: "getClaims",
    description: "List the patient's medical claims, optionally filtered by status.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["submitted", "pending", "paid", "denied"] },
        limit: { type: "integer" },
      },
    },
  },
  {
    type: "function",
    name: "getClaimStatus",
    description: "Get the status and details of a single claim by its id (e.g. clm_000123).",
    parameters: {
      type: "object",
      properties: { claimId: { type: "string" } },
      required: ["claimId"],
    },
  },
  {
    type: "function",
    name: "getCoverageSummary",
    description: "Get the patient's insurance plan: plan name, type, copays, deductible, and out-of-pocket max.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "getDeductibleStatus",
    description: "Get how much of the deductible and out-of-pocket max the patient has met and has remaining.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "getPrescriptions",
    description: "List the patient's prescriptions, optionally filtered by status.",
    parameters: {
      type: "object",
      properties: { status: { type: "string", enum: ["active", "expired", "discontinued"] } },
    },
  },
  {
    type: "function",
    name: "getRefillInfo",
    description: "Get refill information (refills remaining, last filled, pharmacy) for the patient's prescriptions, optionally filtered by drug name.",
    parameters: {
      type: "object",
      properties: { drugName: { type: "string" } },
    },
  },
  {
    type: "function",
    name: "getProviderInfo",
    description: "Get the patient's providers (their primary care provider and providers seen on claims), optionally filtered by specialty.",
    parameters: {
      type: "object",
      properties: { specialty: { type: "string" } },
    },
  },
  {
    type: "function",
    name: "generalHealthEducation",
    description: "Use for general, non-personalized health or insurance education questions that do not require the patient's own data.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string" } },
    },
  },
];

export const TOOL_NAMES = TOOL_SCHEMAS.map((t) => t.name);

type ToolArgs = Record<string, any>;

/** Executes a tool, always scoped to the given patientId. Returns JSON-serializable data. */
export async function executeTool(
  name: string,
  patientId: string,
  args: ToolArgs,
  tracer?: Tracer,
): Promise<unknown> {
  const db = await getDb();

  switch (name) {
    case "getClaims": {
      const filter: any = { patientId };
      if (args.status) filter.status = args.status;
      tracer?.mongo(
        { collection: COLLECTIONS.claims, operation: "find", query: filter },
        `Tool getClaims → query claims`,
      );
      const claims = await db
        .collection<Claim>(COLLECTIONS.claims)
        .find(filter)
        .sort({ serviceDate: -1 })
        .limit(Math.min(args.limit ?? 25, 50))
        .toArray();
      return { count: claims.length, claims };
    }
    case "getClaimStatus": {
      const filter = { _id: args.claimId, patientId };
      tracer?.mongo(
        { collection: COLLECTIONS.claims, operation: "findOne", query: filter },
        `Tool getClaimStatus → look up claim`,
      );
      const claim = await db.collection<Claim>(COLLECTIONS.claims).findOne(filter as any);
      return claim ?? { error: `No claim ${args.claimId} found for this patient.` };
    }
    case "getCoverageSummary":
    case "getDeductibleStatus": {
      tracer?.mongo(
        { collection: COLLECTIONS.coverage, operation: "findOne", query: { patientId } },
        `Tool ${name} → query coverage`,
      );
      const coverage = await db
        .collection<Coverage>(COLLECTIONS.coverage)
        .findOne({ patientId } as any);
      if (!coverage) return { error: "No coverage on file." };
      if (name === "getDeductibleStatus") {
        return {
          deductible: {
            ...coverage.deductible,
            remaining: Math.round((coverage.deductible.individual - coverage.deductible.met) * 100) / 100,
          },
          outOfPocketMax: {
            ...coverage.outOfPocketMax,
            remaining: Math.round((coverage.outOfPocketMax.individual - coverage.outOfPocketMax.met) * 100) / 100,
          },
        };
      }
      return coverage;
    }
    case "getPrescriptions": {
      const filter: any = { patientId };
      if (args.status) filter.status = args.status;
      tracer?.mongo(
        { collection: COLLECTIONS.prescriptions, operation: "find", query: filter },
        "Tool getPrescriptions → query prescriptions",
      );
      const rx = await db.collection<Prescription>(COLLECTIONS.prescriptions).find(filter).toArray();
      return { count: rx.length, prescriptions: rx };
    }
    case "getRefillInfo": {
      const filter: any = { patientId };
      if (args.drugName) filter.drugName = { $regex: new RegExp(args.drugName, "i") };
      tracer?.mongo(
        { collection: COLLECTIONS.prescriptions, operation: "find", query: filter },
        "Tool getRefillInfo → query prescription refills",
      );
      const rx = await db
        .collection<Prescription>(COLLECTIONS.prescriptions)
        .find(filter)
        .project({ drugName: 1, dosage: 1, refillsRemaining: 1, refillsAuthorized: 1, lastFilled: 1, pharmacy: 1, status: 1 })
        .toArray();
      return { count: rx.length, prescriptions: rx };
    }
    case "getProviderInfo": {
      tracer?.mongo(
        { collection: COLLECTIONS.claims, operation: "find", query: { patientId } },
        "Tool getProviderInfo → find providers on claims",
      );
      const claims = await db.collection<Claim>(COLLECTIONS.claims).find({ patientId }).toArray();
      const patient = await db.collection(COLLECTIONS.patients).findOne({ _id: patientId } as any);
      const providerIds = new Set<string>(claims.map((c) => c.providerId));
      if (patient?.pcpProviderId) providerIds.add(patient.pcpProviderId);
      const query: any = { _id: { $in: [...providerIds] } };
      if (args.specialty) query.specialty = { $regex: new RegExp(args.specialty, "i") };
      tracer?.mongo(
        { collection: COLLECTIONS.providers, operation: "find", query: { _id: { $in: `[${providerIds.size} ids]` } } },
        "Tool getProviderInfo → load provider details",
      );
      const providers = await db.collection<Provider>(COLLECTIONS.providers).find(query).toArray();
      return { pcpProviderId: patient?.pcpProviderId ?? null, count: providers.length, providers };
    }
    case "generalHealthEducation": {
      tracer?.decision("Tool generalHealthEducation → no database query (general answer)");
      return {
        note: "No patient-specific data. Answer generally and remind the user this is not medical advice.",
        topic: args.topic ?? null,
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
