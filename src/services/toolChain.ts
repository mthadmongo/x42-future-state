import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";
import { getToolDef, toolsForIntent } from "./toolRegistry";
import type { Tracer } from "../lib/trace";
import type { Claim, Coverage, Prescription, Provider } from "../types";

/** Accumulates params (inputs) and tool outputs as the chain runs. */
export interface ChainContext {
  patientId: string;
  params: Record<string, any>;
  outputs: Record<string, unknown>;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Code-backed executors for the atomic tools. Each is scoped to ctx.patientId
 * (session identity — never client-provided) and writes to ctx.outputs. The
 * `tools` registry provides metadata/sample query; execution lives here.
 */
async function executeAtomicTool(name: string, ctx: ChainContext, tracer?: Tracer): Promise<void> {
  const db = await getDb();
  const def = await getToolDef(name);
  const { patientId, params } = ctx;

  switch (name) {
    case "resolvePatientContext": {
      tracer?.mongo(
        { collection: COLLECTIONS.patients, operation: "findOne", query: { _id: patientId } },
        `Tool resolvePatientContext → ${def?.description ?? "resolve member"}`,
      );
      const patient = await db.collection(COLLECTIONS.patients).findOne({ _id: patientId } as any);
      ctx.outputs.patientProfile = patient
        ? { id: patient._id, name: patient.name, dob: patient.dob, sex: patient.sex, memberId: patient.memberId }
        : { error: "patient not found" };
      break;
    }
    case "findClaimsByPatient": {
      const filter: any = { patientId };
      if (params.status) filter.status = params.status;
      tracer?.mongo({ collection: COLLECTIONS.claims, operation: "find", query: filter }, "Tool findClaimsByPatient");
      const claims = await db.collection<Claim>(COLLECTIONS.claims).find(filter).sort({ serviceDate: -1 }).limit(50).toArray();
      ctx.outputs.claims = claims;
      break;
    }
    case "findClaimById": {
      const filter = { _id: params.claimId, patientId };
      tracer?.mongo({ collection: COLLECTIONS.claims, operation: "findOne", query: filter }, "Tool findClaimById");
      ctx.outputs.claim = params.claimId
        ? (await db.collection<Claim>(COLLECTIONS.claims).findOne(filter as any)) ?? { error: `No claim ${params.claimId}` }
        : { error: "claimId not provided" };
      break;
    }
    case "getCoverageByPatient": {
      tracer?.mongo({ collection: COLLECTIONS.coverage, operation: "findOne", query: { patientId } }, "Tool getCoverageByPatient");
      const coverage = await db.collection<Coverage>(COLLECTIONS.coverage).findOne({ patientId } as any);
      ctx.outputs.coverage = coverage ?? { error: "no coverage on file" };
      break;
    }
    case "computeDeductibleStatus": {
      tracer?.decision("Tool computeDeductibleStatus → derive met/remaining (no DB query)");
      const coverage = ctx.outputs.coverage as Coverage | undefined;
      if (coverage && coverage.deductible) {
        ctx.outputs.deductibleStatus = {
          deductible: { ...coverage.deductible, remaining: round(coverage.deductible.individual - coverage.deductible.met) },
          outOfPocketMax: {
            ...coverage.outOfPocketMax,
            remaining: round(coverage.outOfPocketMax.individual - coverage.outOfPocketMax.met),
          },
        };
      } else {
        ctx.outputs.deductibleStatus = { error: "no coverage to derive from" };
      }
      break;
    }
    case "findPrescriptionsByPatient": {
      const filter: any = { patientId };
      if (params.status) filter.status = params.status;
      tracer?.mongo({ collection: COLLECTIONS.prescriptions, operation: "find", query: filter }, "Tool findPrescriptionsByPatient");
      ctx.outputs.prescriptions = await db.collection<Prescription>(COLLECTIONS.prescriptions).find(filter).toArray();
      break;
    }
    case "findRefillsByPatient": {
      const filter: any = { patientId };
      if (params.drugName) filter.drugName = { $regex: new RegExp(params.drugName, "i") };
      tracer?.mongo({ collection: COLLECTIONS.prescriptions, operation: "find", query: filter }, "Tool findRefillsByPatient");
      ctx.outputs.refills = await db
        .collection<Prescription>(COLLECTIONS.prescriptions)
        .find(filter)
        .project({ drugName: 1, dosage: 1, refillsRemaining: 1, refillsAuthorized: 1, lastFilled: 1, pharmacy: 1, status: 1 })
        .toArray();
      break;
    }
    case "findProvidersForPatient": {
      tracer?.mongo({ collection: COLLECTIONS.claims, operation: "find", query: { patientId } }, "Tool findProvidersForPatient → provider ids from claims");
      const claims = await db.collection<Claim>(COLLECTIONS.claims).find({ patientId }).toArray();
      const patient = await db.collection(COLLECTIONS.patients).findOne({ _id: patientId } as any);
      const providerIds = new Set<string>(claims.map((c) => c.providerId));
      if (patient?.pcpProviderId) providerIds.add(patient.pcpProviderId);
      tracer?.mongo(
        { collection: COLLECTIONS.providers, operation: "find", query: { _id: { $in: `[${providerIds.size} ids]` } } },
        "Tool findProvidersForPatient → load provider details",
      );
      const providers = await db.collection<Provider>(COLLECTIONS.providers).find({ _id: { $in: [...providerIds] } } as any).toArray();
      ctx.outputs.providers = providers;
      ctx.outputs.pcpProviderId = patient?.pcpProviderId ?? null;
      break;
    }
    default:
      ctx.outputs[`${name}_error`] = `unknown tool: ${name}`;
  }
}

export interface ChainResult {
  toolsRun: string[];
  data: Record<string, unknown>;
}

/**
 * Deterministically execute the ordered tool chain mapped to an intent.
 * No LLM tool-selection — the chain is fixed data from the intent → tools mapping.
 */
export async function runToolChain(
  intent: string,
  patientId: string,
  params: Record<string, any> = {},
  tracer?: Tracer,
): Promise<ChainResult> {
  const tools = toolsForIntent(intent);
  const ctx: ChainContext = { patientId, params, outputs: {} };

  tracer?.decision(`Executing deterministic tool chain for "${intent}"`, tools.length ? tools.join(" → ") : "no tools (general answer)");

  for (const toolName of tools) {
    await executeAtomicTool(toolName, ctx, tracer);
  }

  return { toolsRun: tools, data: ctx.outputs };
}
