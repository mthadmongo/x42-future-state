import Link from "next/link";
import { listPatients } from "../src/services/patients";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const patients = await listPatients();

  return (
    <section>
      <h1>Who are you?</h1>
      <p className="muted">
        Select a patient to start a conversation. Everything (chat history and the semantic cache)
        is scoped to the patient you pick.
      </p>
      <div className="patient-grid">
        {patients.map((p) => (
          <Link key={p.id} href={`/chat/${p.id}`} className="patient-card">
            <div className="name">{p.name}</div>
            <div className="meta">
              {p.sex} · DOB {p.dob} · {p.memberId}
            </div>
            <div className="plan">{p.planName}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
