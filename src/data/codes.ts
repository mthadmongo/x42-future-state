export interface Icd10 {
  code: string;
  description: string;
}

export interface Cpt {
  code: string;
  description: string;
  typicalBilled: [number, number]; // [min, max]
}

export interface Drug {
  name: string;
  ndc: string;
  dosage: string;
  form: string;
  brand: boolean;
  conditionCode: string; // ICD-10 this drug typically treats
}

export const ICD10: Icd10[] = [
  { code: "I10", description: "Essential (primary) hypertension" },
  { code: "E11.9", description: "Type 2 diabetes mellitus without complications" },
  { code: "E78.5", description: "Hyperlipidemia, unspecified" },
  { code: "J45.909", description: "Unspecified asthma, uncomplicated" },
  { code: "K21.9", description: "Gastro-esophageal reflux disease without esophagitis" },
  { code: "F41.9", description: "Anxiety disorder, unspecified" },
  { code: "M54.5", description: "Low back pain" },
  { code: "E03.9", description: "Hypothyroidism, unspecified" },
  { code: "N39.0", description: "Urinary tract infection, site not specified" },
  { code: "M17.9", description: "Osteoarthritis of knee, unspecified" },
];

export const CPT: Cpt[] = [
  { code: "99213", description: "Office/outpatient visit, established patient, low complexity", typicalBilled: [120, 200] },
  { code: "99214", description: "Office/outpatient visit, established patient, moderate complexity", typicalBilled: [180, 320] },
  { code: "99203", description: "Office/outpatient visit, new patient, low complexity", typicalBilled: [150, 260] },
  { code: "93000", description: "Electrocardiogram, complete", typicalBilled: [80, 160] },
  { code: "80053", description: "Comprehensive metabolic panel", typicalBilled: [40, 120] },
  { code: "85025", description: "Complete blood count (CBC) with differential", typicalBilled: [30, 90] },
  { code: "71046", description: "Chest X-ray, 2 views", typicalBilled: [150, 350] },
  { code: "90471", description: "Immunization administration", typicalBilled: [25, 60] },
  { code: "20610", description: "Arthrocentesis/injection, major joint", typicalBilled: [180, 400] },
  { code: "36415", description: "Routine venipuncture", typicalBilled: [15, 40] },
];

export const DRUGS: Drug[] = [
  { name: "Lisinopril", ndc: "00093-0123-01", dosage: "10 mg", form: "tablet", brand: false, conditionCode: "I10" },
  { name: "Amlodipine", ndc: "00093-0135-01", dosage: "5 mg", form: "tablet", brand: false, conditionCode: "I10" },
  { name: "Metformin", ndc: "00093-1045-01", dosage: "500 mg", form: "tablet", brand: false, conditionCode: "E11.9" },
  { name: "Atorvastatin", ndc: "00093-5058-01", dosage: "20 mg", form: "tablet", brand: false, conditionCode: "E78.5" },
  { name: "Albuterol HFA", ndc: "00093-3174-01", dosage: "90 mcg", form: "inhaler", brand: false, conditionCode: "J45.909" },
  { name: "Omeprazole", ndc: "00093-5177-01", dosage: "20 mg", form: "capsule", brand: false, conditionCode: "K21.9" },
  { name: "Sertraline", ndc: "00093-7101-01", dosage: "50 mg", form: "tablet", brand: false, conditionCode: "F41.9" },
  { name: "Levothyroxine", ndc: "00093-0503-01", dosage: "50 mcg", form: "tablet", brand: false, conditionCode: "E03.9" },
  { name: "Ibuprofen", ndc: "00093-0113-01", dosage: "600 mg", form: "tablet", brand: false, conditionCode: "M54.5" },
  { name: "Amoxicillin", ndc: "00093-4155-01", dosage: "500 mg", form: "capsule", brand: false, conditionCode: "N39.0" },
];

export const SPECIALTIES = [
  "Family Medicine",
  "Internal Medicine",
  "Cardiology",
  "Endocrinology",
  "Pulmonology",
  "Gastroenterology",
  "Orthopedics",
  "Psychiatry",
];

export const PHARMACIES = [
  "CVS Pharmacy #1042",
  "Walgreens #3387",
  "Rite Aid #221",
  "Walmart Pharmacy #5567",
  "Kroger Pharmacy #889",
];

export const DENIAL_REASONS = [
  "Service not covered under current plan",
  "Prior authorization required",
  "Out-of-network provider",
  "Duplicate claim submission",
  "Missing or invalid diagnosis code",
];
