/**
 * Registry of ATOMIC, reusable tools. Each is a single read/compute operation.
 * These documents seed the `tools` collection. `sampleQuery` is a placeholder
 * template used for reference/observability (shown in the trace) — execution is
 * always done by code-backed executors (see src/services/toolChain.ts), not by
 * running the stored query.
 */

export type ToolOperation = "find" | "findOne" | "aggregate" | "compute";

export interface ToolDef {
  name: string;
  description: string;
  targetCollection: string | null; // null for "compute" (derived) tools
  operation: ToolOperation;
  sampleQuery: unknown; // template with {{placeholders}} — reference only
  inputs: string[]; // keys consumed (patientId is always session-injected)
  outputs: string[]; // keys produced (flow to later tools / synthesis)
  requiresArgs: boolean; // needs params beyond the session patientId (filled by extraction)
  params?: Record<string, { type: string; required: boolean; description: string }>;
  readOnly: boolean;
}

export const TOOL_REGISTRY: ToolDef[] = [
  {
    name: "resolvePatientContext",
    description: "Resolve the current member from the session and return their id and basic profile.",
    targetCollection: "patients",
    operation: "findOne",
    sampleQuery: { _id: "{{patientId}}" },
    inputs: ["patientId"],
    outputs: ["patientId", "patientProfile"],
    requiresArgs: false,
    readOnly: true,
  },
  {
    name: "findClaimsByPatient",
    description: "Find the member's claims, optionally filtered by status.",
    targetCollection: "claims",
    operation: "find",
    sampleQuery: { patientId: "{{patientId}}", status: "{{status?}}" },
    inputs: ["patientId"],
    outputs: ["claims"],
    requiresArgs: false,
    params: { status: { type: "string", required: false, description: "submitted|pending|paid|denied" } },
    readOnly: true,
  },
  {
    name: "findClaimById",
    description: "Look up a single claim by its id for the member.",
    targetCollection: "claims",
    operation: "findOne",
    sampleQuery: { _id: "{{claimId}}", patientId: "{{patientId}}" },
    inputs: ["patientId", "claimId"],
    outputs: ["claim"],
    requiresArgs: true,
    params: { claimId: { type: "string", required: true, description: "claim id, e.g. clm_001001" } },
    readOnly: true,
  },
  {
    name: "getCoverageByPatient",
    description: "Get the member's insurance coverage/plan document.",
    targetCollection: "coverage",
    operation: "findOne",
    sampleQuery: { patientId: "{{patientId}}" },
    inputs: ["patientId"],
    outputs: ["coverage"],
    requiresArgs: false,
    readOnly: true,
  },
  {
    name: "computeDeductibleStatus",
    description: "Derive deductible and out-of-pocket met/remaining from the coverage document.",
    targetCollection: null,
    operation: "compute",
    sampleQuery: { derivedFrom: "coverage", computes: ["deductible.remaining", "outOfPocketMax.remaining"] },
    inputs: ["coverage"],
    outputs: ["deductibleStatus"],
    requiresArgs: false,
    readOnly: true,
  },
  {
    name: "findPrescriptionsByPatient",
    description: "List the member's prescriptions, optionally filtered by status.",
    targetCollection: "prescriptions",
    operation: "find",
    sampleQuery: { patientId: "{{patientId}}", status: "{{status?}}" },
    inputs: ["patientId"],
    outputs: ["prescriptions"],
    requiresArgs: false,
    params: { status: { type: "string", required: false, description: "active|expired|discontinued" } },
    readOnly: true,
  },
  {
    name: "findRefillsByPatient",
    description: "Get refill info (refills remaining, last filled, pharmacy) for the member's prescriptions, optionally filtered by drug name.",
    targetCollection: "prescriptions",
    operation: "find",
    sampleQuery: { patientId: "{{patientId}}", drugName: "{{drugName?}}" },
    inputs: ["patientId"],
    outputs: ["refills"],
    requiresArgs: false,
    params: { drugName: { type: "string", required: false, description: "optional drug name filter" } },
    readOnly: true,
  },
  {
    name: "findProvidersForPatient",
    description: "Return the member's providers (PCP plus providers seen on their claims).",
    targetCollection: "providers",
    operation: "aggregate",
    sampleQuery: [
      { $match: { patientId: "{{patientId}}" } },
      { $group: { _id: null, providerIds: { $addToSet: "$providerId" } } },
    ],
    inputs: ["patientId"],
    outputs: ["providers"],
    requiresArgs: false,
    readOnly: true,
  },
];

/** Intent → ordered tool chain. Identity first, then data, then any derivation. */
export const INTENT_TOOLS: Record<string, string[]> = {
  getClaims: ["resolvePatientContext", "findClaimsByPatient"],
  getClaimStatus: ["resolvePatientContext", "findClaimById"],
  getCoverageSummary: ["resolvePatientContext", "getCoverageByPatient"],
  getDeductibleStatus: ["resolvePatientContext", "getCoverageByPatient", "computeDeductibleStatus"],
  getPrescriptions: ["resolvePatientContext", "findPrescriptionsByPatient"],
  getRefillInfo: ["resolvePatientContext", "findRefillsByPatient"],
  getProviderInfo: ["resolvePatientContext", "findProvidersForPatient"],
  generalHealthEducation: [],
};
