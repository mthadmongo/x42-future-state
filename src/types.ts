export type ClaimStatus = "submitted" | "pending" | "paid" | "denied";
export type RxStatus = "active" | "expired" | "discontinued";
export type PlanType = "PPO" | "HMO" | "EPO" | "HDHP";

export interface Provider {
  _id: string;
  name: string;
  specialty: string;
  npi: string;
  city: string;
  state: string;
  phone: string;
}

export interface Patient {
  _id: string;
  name: { first: string; last: string };
  dob: string; // YYYY-MM-DD
  sex: "M" | "F";
  contact: { email: string; phone: string };
  address: { street: string; city: string; state: string; zip: string };
  memberId: string;
  coverageId: string;
  pcpProviderId: string;
  /** ICD-10 codes this patient is managed for (drives claims/rx alignment). */
  conditionCodes: string[];
}

export interface Coverage {
  _id: string;
  patientId: string;
  planName: string;
  planType: PlanType;
  effectiveDate: string;
  deductible: { individual: number; met: number };
  outOfPocketMax: { individual: number; met: number };
  copays: {
    primaryCare: number;
    specialist: number;
    genericRx: number;
    brandRx: number;
    emergencyRoom: number;
  };
}

export interface Claim {
  _id: string;
  patientId: string;
  providerId: string;
  providerName: string; // extended-reference cache
  providerSpecialty: string;
  serviceDate: string;
  status: ClaimStatus;
  cptCodes: string[];
  cptDescriptions: string[];
  diagnosisCodes: string[];
  diagnosisDescriptions: string[];
  billedAmount: number;
  allowedAmount: number;
  planPaid: number;
  patientResponsibility: number;
  denialReason?: string;
}

export interface Prescription {
  _id: string;
  patientId: string;
  prescriberId: string;
  prescriberName: string;
  drugName: string;
  ndc: string;
  dosage: string;
  form: string;
  quantity: number;
  daysSupply: number;
  refillsRemaining: number;
  refillsAuthorized: number;
  lastFilled: string;
  pharmacy: string;
  status: RxStatus;
}

export interface GeneratedData {
  providers: Provider[];
  patients: Patient[];
  coverage: Coverage[];
  claims: Claim[];
  prescriptions: Prescription[];
}
