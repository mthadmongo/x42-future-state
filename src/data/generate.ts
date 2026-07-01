import { faker } from "@faker-js/faker";
import type {
  Claim,
  ClaimStatus,
  Coverage,
  GeneratedData,
  Patient,
  PlanType,
  Prescription,
  Provider,
} from "../types.js";
import { CPT, DENIAL_REASONS, DRUGS, ICD10, PHARMACIES, SPECIALTIES } from "./codes.js";

const SEED = 42;
const NUM_PATIENTS = 20;
const NUM_PROVIDERS = 15;

const money = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number, width = 4) => String(n).padStart(width, "0");
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function makeProviders(): Provider[] {
  return Array.from({ length: NUM_PROVIDERS }, (_, i) => {
    const specialty = faker.helpers.arrayElement(SPECIALTIES);
    return {
      _id: `prov_${pad(i + 1)}`,
      name: `Dr. ${faker.person.firstName()} ${faker.person.lastName()}`,
      specialty,
      npi: faker.string.numeric(10),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      phone: faker.phone.number({ style: "national" }),
    };
  });
}

function makeCoverage(patientId: string, index: number): Coverage {
  const planType = faker.helpers.arrayElement<PlanType>(["PPO", "HMO", "EPO", "HDHP"]);
  const deductibleIndividual = faker.helpers.arrayElement([1000, 1500, 2000, 2500, 3000]);
  const oopMax = faker.helpers.arrayElement([5000, 6000, 7500, 8500, 9000]);
  return {
    _id: `cov_${pad(index + 1)}`,
    patientId,
    planName: `${faker.helpers.arrayElement(["Blue", "Summit", "Horizon", "Cascade"])} ${planType} ${deductibleIndividual}`,
    planType,
    effectiveDate: `${new Date().getFullYear()}-01-01`,
    // met values filled during the consistency pass
    deductible: { individual: deductibleIndividual, met: 0 },
    outOfPocketMax: { individual: oopMax, met: 0 },
    copays: {
      primaryCare: faker.helpers.arrayElement([20, 25, 30]),
      specialist: faker.helpers.arrayElement([40, 50, 60]),
      genericRx: faker.helpers.arrayElement([5, 10, 15]),
      brandRx: faker.helpers.arrayElement([25, 35, 50]),
      emergencyRoom: faker.helpers.arrayElement([150, 250, 350]),
    },
  };
}

function makePatient(index: number, providers: Provider[]): Patient {
  const sex = faker.helpers.arrayElement<"M" | "F">(["M", "F"]);
  const first = faker.person.firstName(sex === "M" ? "male" : "female");
  const last = faker.person.lastName();
  const pcp =
    providers.find((p) => ["Family Medicine", "Internal Medicine"].includes(p.specialty)) ??
    faker.helpers.arrayElement(providers);
  const conditionCodes = faker.helpers
    .arrayElements(ICD10, faker.number.int({ min: 1, max: 3 }))
    .map((c) => c.code);
  return {
    _id: `pat_${pad(index + 1)}`,
    name: { first, last },
    dob: isoDate(faker.date.birthdate({ min: 19, max: 85, mode: "age" })),
    sex,
    contact: {
      email: faker.internet.email({ firstName: first, lastName: last }).toLowerCase(),
      phone: faker.phone.number({ style: "national" }),
    },
    address: {
      street: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state({ abbreviated: true }),
      zip: faker.location.zipCode(),
    },
    memberId: `MBR${faker.string.numeric(8)}`,
    coverageId: `cov_${pad(index + 1)}`,
    pcpProviderId: pcp._id,
    conditionCodes,
  };
}

function makeClaims(patient: Patient, providers: Provider[], startId: number): Claim[] {
  const count = faker.number.int({ min: 5, max: 15 });
  const pcp = providers.find((p) => p._id === patient.pcpProviderId)!;
  return Array.from({ length: count }, (_, i) => {
    const provider = faker.datatype.boolean(0.6)
      ? pcp
      : faker.helpers.arrayElement(providers);
    const cpts = faker.helpers.arrayElements(CPT, faker.number.int({ min: 1, max: 2 }));
    const billed = money(
      cpts.reduce(
        (sum, c) => sum + faker.number.float({ min: c.typicalBilled[0], max: c.typicalBilled[1] }),
        0,
      ),
    );
    const allowed = money(billed * faker.number.float({ min: 0.45, max: 0.85 }));
    const status = faker.helpers.weightedArrayElement<ClaimStatus>([
      { value: "paid", weight: 6 },
      { value: "pending", weight: 2 },
      { value: "submitted", weight: 1 },
      { value: "denied", weight: 1 },
    ]);

    const dxCodes = faker.helpers.arrayElements(
      patient.conditionCodes,
      faker.number.int({ min: 1, max: Math.min(2, patient.conditionCodes.length) }),
    );
    const dxDescriptions = dxCodes.map(
      (code) => ICD10.find((c) => c.code === code)?.description ?? code,
    );

    let planPaid = 0;
    let patientResponsibility = 0;
    let denialReason: string | undefined;
    if (status === "denied") {
      denialReason = faker.helpers.arrayElement(DENIAL_REASONS);
    } else {
      patientResponsibility = money(allowed * faker.number.float({ min: 0.1, max: 0.4 }));
      planPaid = money(allowed - patientResponsibility);
    }

    return {
      _id: `clm_${pad(startId + i, 6)}`,
      patientId: patient._id,
      providerId: provider._id,
      providerName: provider.name,
      providerSpecialty: provider.specialty,
      serviceDate: isoDate(faker.date.recent({ days: 365 })),
      status,
      cptCodes: cpts.map((c) => c.code),
      cptDescriptions: cpts.map((c) => c.description),
      diagnosisCodes: dxCodes,
      diagnosisDescriptions: dxDescriptions,
      billedAmount: billed,
      allowedAmount: allowed,
      planPaid,
      patientResponsibility,
      ...(denialReason ? { denialReason } : {}),
    };
  });
}

function makePrescriptions(patient: Patient, providers: Provider[], startId: number): Prescription[] {
  const pcp = providers.find((p) => p._id === patient.pcpProviderId)!;
  // Prefer drugs matching the patient's conditions, then top up with extras.
  const matched = DRUGS.filter((d) => patient.conditionCodes.includes(d.conditionCode));
  const extras = faker.helpers.arrayElements(DRUGS, faker.number.int({ min: 1, max: 3 }));
  const chosen = [...new Map([...matched, ...extras].map((d) => [d.ndc, d])).values()].slice(0, 8);

  return chosen.map((drug, i) => {
    const authorized = faker.number.int({ min: 0, max: 5 });
    return {
      _id: `rx_${pad(startId + i, 6)}`,
      patientId: patient._id,
      prescriberId: pcp._id,
      prescriberName: pcp.name,
      drugName: drug.name,
      ndc: drug.ndc,
      dosage: drug.dosage,
      form: drug.form,
      quantity: faker.helpers.arrayElement([30, 60, 90]),
      daysSupply: faker.helpers.arrayElement([30, 60, 90]),
      refillsAuthorized: authorized,
      refillsRemaining: faker.number.int({ min: 0, max: authorized }),
      lastFilled: isoDate(faker.date.recent({ days: 120 })),
      pharmacy: faker.helpers.arrayElement(PHARMACIES),
      status: faker.helpers.weightedArrayElement<Prescription["status"]>([
        { value: "active", weight: 7 },
        { value: "expired", weight: 2 },
        { value: "discontinued", weight: 1 },
      ]),
    };
  });
}

/** Fill deductible.met / outOfPocketMax.met from paid claims (capped at plan limits). */
function applyRollup(coverage: Coverage, claims: Claim[]): void {
  const sumPaidPR = money(
    claims
      .filter((c) => c.status === "paid")
      .reduce((sum, c) => sum + c.patientResponsibility, 0),
  );
  coverage.deductible.met = money(Math.min(sumPaidPR, coverage.deductible.individual));
  coverage.outOfPocketMax.met = money(Math.min(sumPaidPR, coverage.outOfPocketMax.individual));
}

export function generateData(): GeneratedData {
  faker.seed(SEED);

  const providers = makeProviders();
  const patients: Patient[] = [];
  const coverage: Coverage[] = [];
  const claims: Claim[] = [];
  const prescriptions: Prescription[] = [];

  let claimId = 1;
  let rxId = 1;

  for (let i = 0; i < NUM_PATIENTS; i++) {
    const patient = makePatient(i, providers);
    const cov = makeCoverage(patient._id, i);
    const patientClaims = makeClaims(patient, providers, claimId);
    const patientRx = makePrescriptions(patient, providers, rxId);
    claimId += patientClaims.length;
    rxId += patientRx.length;

    applyRollup(cov, patientClaims);

    patients.push(patient);
    coverage.push(cov);
    claims.push(...patientClaims);
    prescriptions.push(...patientRx);
  }

  return { providers, patients, coverage, claims, prescriptions };
}
