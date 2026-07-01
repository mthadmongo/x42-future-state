import { COLLECTIONS } from "../src/config.js";
import { getDb, closeClient } from "../src/lib/mongo.js";
import { generateData } from "../src/data/generate.js";
import type { Claim, Coverage, Patient, Prescription, Provider } from "../src/types.js";

const money = (n: number) => Math.round(n * 100) / 100;

async function main() {
  console.log("=== Phase 1 verify-data ===\n");
  const db = await getDb();
  const failures: string[] = [];
  const pass = (msg: string) => console.log(`PASS  ${msg}`);
  const fail = (msg: string) => {
    console.log(`FAIL  ${msg}`);
    failures.push(msg);
  };

  const providers = await db.collection<Provider>(COLLECTIONS.providers).find().toArray();
  const patients = await db.collection<Patient>(COLLECTIONS.patients).find().toArray();
  const coverage = await db.collection<Coverage>(COLLECTIONS.coverage).find().toArray();
  const claims = await db.collection<Claim>(COLLECTIONS.claims).find().toArray();
  const prescriptions = await db.collection<Prescription>(COLLECTIONS.prescriptions).find().toArray();

  // 1. Non-zero, sane counts
  patients.length >= 15 ? pass(`patients count = ${patients.length}`) : fail(`patients count too low: ${patients.length}`);
  providers.length > 0 ? pass(`providers count = ${providers.length}`) : fail("no providers");
  claims.length > 0 ? pass(`claims count = ${claims.length}`) : fail("no claims");
  prescriptions.length > 0 ? pass(`prescriptions count = ${prescriptions.length}`) : fail("no prescriptions");
  coverage.length === patients.length
    ? pass(`coverage count matches patients = ${coverage.length}`)
    : fail(`coverage (${coverage.length}) != patients (${patients.length})`);

  const providerIds = new Set(providers.map((p) => p._id));
  const coverageByPatient = new Map(coverage.map((c) => [c.patientId, c]));

  // 2. Referential integrity
  const badClaimRefs = claims.filter((c) => !providerIds.has(c.providerId));
  badClaimRefs.length === 0
    ? pass("every claim.providerId resolves to a provider")
    : fail(`${badClaimRefs.length} claims reference unknown providers`);

  const badRxRefs = prescriptions.filter((r) => !providerIds.has(r.prescriberId));
  badRxRefs.length === 0
    ? pass("every prescription.prescriberId resolves to a provider")
    : fail(`${badRxRefs.length} prescriptions reference unknown prescribers`);

  // 3. Deductible rollup correctness per patient
  let rollupErrors = 0;
  for (const patient of patients) {
    const cov = coverageByPatient.get(patient._id);
    if (!cov) {
      fail(`patient ${patient._id} has no coverage`);
      continue;
    }
    const sumPaidPR = money(
      claims
        .filter((c) => c.patientId === patient._id && c.status === "paid")
        .reduce((sum, c) => sum + c.patientResponsibility, 0),
    );
    const expectedMet = money(Math.min(sumPaidPR, cov.deductible.individual));
    if (cov.deductible.met !== expectedMet) rollupErrors++;
    if (cov.deductible.met > cov.deductible.individual) rollupErrors++;
  }
  rollupErrors === 0
    ? pass("deductible.met = min(sum paid patientResponsibility, deductible.individual) for all patients")
    : fail(`${rollupErrors} patients have incorrect deductible rollup`);

  // 4. Reproducibility: DB ids match a fresh generation
  const fresh = generateData();
  const dbPatientIds = patients.map((p) => p._id).sort();
  const genPatientIds = fresh.patients.map((p) => p._id).sort();
  JSON.stringify(dbPatientIds) === JSON.stringify(genPatientIds)
    ? pass("patient _ids are reproducible across generation runs")
    : fail("patient _ids differ from a fresh generation (non-deterministic seed)");

  // Spot-check sample
  const sample = patients[0];
  const cov = coverageByPatient.get(sample._id)!;
  console.log(
    `\nSample patient ${sample._id} (${sample.name.first} ${sample.name.last}): ` +
      `${claims.filter((c) => c.patientId === sample._id).length} claims, ` +
      `${prescriptions.filter((r) => r.patientId === sample._id).length} rx, ` +
      `deductible ${cov.deductible.met}/${cov.deductible.individual}`,
  );

  await closeClient();

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("verify-data failed:", err);
  await closeClient();
  process.exit(1);
});
