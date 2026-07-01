# Healthcare Patient Agent — Demo Spec (DRAFT)

> Status: **Planning / spec for review.** No application code yet. This document is
> the agreed-upon plan for how we generate sample data, load it into MongoDB, and
> build the agent. Nothing here is final — it's meant to be argued with.

### Decisions locked in (Update 3)
- **Semantic cache = Plan A**: subclass `MongoDBAtlasSemanticCache` (JS) to embed only the question + pre-filter on `patientId`.
- **Database name: `x42_agent`** — all collections live here.
- **Cache similarity threshold: 0.90.**
- **Grove: Responses API only** (no `/chat/completions`) — confirmed.
- **Volatile intents excluded from cache:** `getDeductibleStatus`, `getRefillInfo`, `getClaimStatus`.
- See **`docs/PHASED_PLAN.md`** for the phased, test-as-you-go build plan.

### Decisions locked in (Update 2)
- **Embeddings:** `voyage-4-large`, **1024 dimensions**, **cosine** similarity.
- **LLM:** Grove gateway (`gpt-5.5`, OpenAI **Responses API**). Verified working, incl. **function/tool calling**.
- **Semantic cache & vector store:** LangChain MongoDB integration (`@langchain/mongodb`). See §7 for an important caveat about per-patient isolation.
- **No TTL index** for now (staleness handled by not caching volatile intents — see §7).
- **Optional collections dropped:** no `conditions`, `allergies`, or `labs`.
- **Intent router:** build the Vector Search intent router **and** a toggle to switch between it and LLM tool-calling (both paths are now first-class).
- **Secrets:** connection string + Grove key + Voyage key are kept **out of the repo** (see §9.1).

## 1. Goal & Scope

Build a demo of a **healthcare chatbot for patients**. A patient picks who they are,
then asks natural-language questions about their **claims, prescriptions, coverage,
and general patient data**. The system uses an LLM to answer, backed entirely by
**MongoDB** for:

- **Operational data** (patients, claims, prescriptions, etc.) — synthetic, generated with Faker.js.
- **Semantic cache** (MongoDB Vector Search) — avoid re-hitting the LLM for semantically-similar questions the patient already asked.
- **(Optional) Intent routing** (MongoDB Vector Search) — map a question to a tool/intent.
- **Conversation history** — per patient.

It is a demo, so the guiding principle is **straightforward but realistic and internally
consistent** data, and a clean end-to-end flow that shows off MongoDB.

### Non-goals
- Real PHI / real integrations. All data is synthetic.
- Production auth, RBAC, HIPAA compliance. We *model* good isolation practices but this is a demo.
- Fine-tuning models.

---

## 2. Proposed Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | One repo for UI + API routes; TS pairs naturally with Faker.js. |
| Database | **MongoDB Atlas** (confirmed available) | Vector Search requires Atlas. Not available on a plain local `mongod`. |
| Orchestration | **LangChain JS** (`langchain`, `@langchain/mongodb`, `@langchain/openai`) | Vector store + semantic cache + chat history building blocks. |
| Driver | Official `mongodb` Node driver | `createSearchIndex` support for vector indexes (used by loader + LangChain). |
| Embeddings | **Voyage AI `voyage-4-large`, 1024 dims, cosine** | Per your decision. LangChain `VoyageEmbeddings`. |
| LLM | **Grove gateway → `gpt-5.5` (OpenAI Responses API)** | Custom `baseURL` + `api-key` header; `useResponsesApi: true`. Tool-calling verified. |
| Data gen | **Faker.js** + curated code lists (ICD-10 / CPT / NDC subsets) | Realistic-looking, internally consistent records. |
| UI | React + Tailwind (or shadcn/ui) | Fast, clean demo UI. |

> ⚠️ **Atlas requirement.** Because the semantic cache (and optional intent router)
> use `$vectorSearch`, we need an Atlas cluster (M0 free tier works for a demo) or the
> Atlas CLI local deployment with Search enabled. We should confirm this before building.

---

## 3. Data Model

> **Database:** all collections below live in the **`x42_agent`** database.

### 3.1 Collections (recommended)

**Core (must-have):**
- `patients` — the anchor entity.
- `claims` — 1:many per patient (grows over time → **reference** patientId).
- `prescriptions` — 1:many per patient (→ **reference** patientId).

**High-value additions (see §6):**
- `coverage` — the patient's insurance plan/benefits (deductible, OOP max, copays). Unlocks the best claims questions.
- `providers` — doctors/pharmacies, shared across patients (many:many → **reference**, cache display fields via extended-reference pattern).

**~~Optional collections — DROPPED per decision~~** (no `conditions`, `allergies`, `labs`).
Diagnosis codes still appear inline on claims for realism, but there is no separate `conditions` collection.

**Agent infrastructure:**
- `conversations` — per-patient chat history (messages in a separate collection to avoid unbounded arrays; see §3.3).
- `semantic_cache` — cached Q&A with embeddings (see §7).
- `intents` — *(only if we do vector-based intent routing)* labeled example utterances per intent.

### 3.2 Modeling decisions (following MongoDB schema-design guidance)

- **Patient is the anchor.** Everything references `patientId`.
- **Embed vs reference:**
  - `coverage` is 1:1 with a patient → could embed in `patients`, but we'll keep it a
    small separate collection so "coverage summary" queries and deductible tracking are clean. (Open for debate.)
  - `claims` / `prescriptions` are 1:many and unbounded → **separate collections, referenced**.
  - `providers` are shared many:many → **separate collection**; cache `providerName`/`specialty`
    onto claims/prescriptions (**extended-reference pattern**) so we don't `$lookup` on every read.
- **Conversation messages are unbounded** → separate `messages` documents referenced by
  `conversationId`, not a growing array inside one doc (avoids the unbounded-array anti-pattern & 16MB limit).
- **Internal consistency is the key to a good demo:**
  - `claim.diagnosisCodes` are drawn from a small curated ICD-10 list (inline on the claim; no separate collection).
  - `claim.providerId` and `prescription.prescriberId` point to real `providers`.
  - Claim `patientResponsibility` amounts roll up to the `coverage.deductible.met` / `outOfPocket.met`
    figures, so "how much of my deductible have I met?" is answerable and correct.

### 3.3 Sketch of key documents (illustrative, not final)

```jsonc
// patients
{
  "_id": "pat_0001",
  "name": { "first": "Jane", "last": "Doe" },
  "dob": "1985-04-12",
  "sex": "F",
  "contact": { "email": "...", "phone": "..." },
  "memberId": "MBR123456",
  "coverageId": "cov_0001",
  "pcpProviderId": "prov_0007"
}

// coverage (1:1 with patient)
{
  "_id": "cov_0001",
  "patientId": "pat_0001",
  "planName": "Blue PPO 2000",
  "planType": "PPO",
  "effectiveDate": "2026-01-01",
  "deductible": { "individual": 2000, "met": 850 },
  "outOfPocketMax": { "individual": 8000, "met": 1200 },
  "copays": { "primaryCare": 25, "specialist": 50, "genericRx": 10 }
}

// claims (1:many, references patient + provider)
{
  "_id": "clm_1001",
  "patientId": "pat_0001",
  "providerId": "prov_0007",
  "providerName": "Dr. Smith (Cardiology)",   // extended-reference cache
  "serviceDate": "2026-03-04",
  "status": "paid",                             // submitted | pending | paid | denied
  "cptCodes": ["99213"],
  "diagnosisCodes": ["I10"],                    // subset of patient's conditions
  "billedAmount": 320.00,
  "allowedAmount": 180.00,
  "planPaid": 130.00,
  "patientResponsibility": 50.00
}

// prescriptions (1:many)
{
  "_id": "rx_2001",
  "patientId": "pat_0001",
  "prescriberId": "prov_0007",
  "drugName": "Lisinopril",
  "ndc": "00093-0123-01",
  "dosage": "10mg",
  "quantity": 30,
  "refillsRemaining": 2,
  "lastFilled": "2026-06-01",
  "pharmacy": "CVS #1234",
  "status": "active"
}
```

---

## 4. Agent End-to-End Flow

```
Patient selects identity (screen)
        │
User question ──► [1] Embed query (Voyage)
        │
        ├─► [2] Semantic cache lookup: $vectorSearch, prefilter patientId, top-1
        │        score ≥ threshold?  ── yes ──► return cached answer (mark "cached")
        │        │
        │        no
        ▼
[3] Intent / tool selection  (LLM tool-calling — primary; see §5)
        │
[4] Execute tool(s) → MongoDB queries fetch that patient's relevant data
        │
[5] Assemble context → LLM generates grounded answer
        │
[6] Write to semantic_cache {query, embedding, answer, intent, patientId, ts}
        │
[7] Append to conversation history (messages)
        │
        ▼
     Answer to patient  (+ "not medical advice" disclaimer)
```

**Tools (each maps to an intent and to a MongoDB query):**
- `getClaims(filters)` / `getClaimStatus(claimId)`
- `getCoverageSummary()` / `getDeductibleStatus()`
- `getPrescriptions()` / `getRefillInfo(rxId)`
- `getProviderInfo(providerId)`
- `generalHealthEducation()` — no patient data, general info (candidate for a **shared** cache; see §7).

---

## 5. Question 2 — Intent classification: Vector search vs. LLM

**Short answer: use LLM tool-calling as the primary router; showcase Vector Search where it's genuinely stronger — the semantic cache. Optionally include a vector intent-router as a demonstrable toggle, not the main path.**

### Why the "token cost" argument for vector intent routing is weak
The premise was "use vector intent classification to reduce token costs." But:
- On a **cache miss**, you still call the LLM to generate the answer regardless of how you routed. Routing with vectors saves only the *routing* tokens, which are tiny compared to answer generation.
- The **semantic cache** is what actually saves real tokens (it skips the whole generation call). That's where the cost win lives.
- Embeddings aren't free either — vector routing trades a small LLM call for an embedding call + a vector query.

So vector-based intent routing's real advantages are **latency and determinism**, not token cost.

### Trade-offs

| Approach | Accuracy on varied phrasing | Multi-intent / compound Qs | Latency | Cost | Maintenance |
|---|---|---|---|---|---|
| **LLM tool-calling** | High | Handles well | 1 LLM call | Low (small routing overhead, or folded into the main call) | Low — just describe tools |
| **Vector intent router** | Good for in-distribution, weak on novel phrasing | Poor (returns single nearest intent) | Very low (embed + `$vectorSearch`) | Very low | Higher — must curate labeled utterances in `intents` |
| **Hybrid** | High | Good | low→1 call | Low | Medium |

### Recommendation (updated — both paths are now first-class, toggle between them)
1. **LLM native tool/function-calling** for choosing which tool(s) to run — robust for healthcare phrasing and compound questions ("show my denied claims and my refills"). **Verified**: Grove `gpt-5.5` supports Responses-API function calling (returns a `function_call` output with parsed arguments).
2. **Vector Search intent router**: embed query → `$vectorSearch` over `intents` labeled example utterances → nearest intent, with an LLM fallback when the top score is below a confidence threshold.
3. A **runtime toggle** (`INTENT_MODE = "llm" | "router"`) switches between the two so we can demo/compare accuracy, latency, and cost side by side.
4. **Best Vector Search showcase remains the semantic cache** (§7) — that's where the real token savings live.

---

## 6. Question 3 — What other data should we store?

Patient + claims + prescriptions is a solid core, but a few additions dramatically
increase the number of realistic questions the agent can answer, **without** blowing up scope:

**Recommended to add:**
1. **Coverage / benefits plan** (`coverage`) — *highest value.* Enables the standout demo
   question: "How much of my deductible have I met?" and copay/out-of-pocket questions.
   Claims are far more meaningful when they tie to a plan.
2. **Providers** (`providers`) — claims and prescriptions already imply a doctor/pharmacy.
   Having a real entity lets us answer "who was my cardiologist for that visit?" and keeps
   references clean.

**Optional (add if time allows, each is small):**
3. **Conditions / diagnoses** (`conditions`, ICD-10) — makes claim diagnosis codes coherent and answers "what conditions am I being treated for?"
4. **Allergies** (`allergies`) — enables a nice prescription-safety angle.
5. **Labs / vitals** (`labs`) — "what was my last A1C?"

**Deliberately skipping** (mention, don't build): appointments/encounters, immunizations,
full EOB documents, formulary, care gaps. Good future extensions, not needed for a tight demo.

**Bottom line:** add **coverage** and **providers** to the must-have set; treat conditions/allergies/labs as optional polish.

---

## 7. Question 4 — Semantic cache design

**Yes — pre-filter the vector search on `patientId`.** This is exactly the multi-tenant
isolation pattern MongoDB Vector Search's `filter` fields are for, and it keeps one
patient's Q&A from ever surfacing for another patient.

### ⚠️ Important: LangChain's stock semantic cache does NOT do per-patient filtering
Investigated `@langchain/mongodb`'s `MongoDBAtlasSemanticCache` (and the Python source):

- The built-in cache is **prompt-global**. Its `lookup()` pre-filters **only** on the
  `llm_string` (model identity) field — there is **no** per-user/per-patient filter.
- It's a **global LLM cache** (`set_llm_cache` / `new ChatOpenAI({ cache })`) that intercepts
  **every** LLM call, including our intent-routing calls — not just the final patient answer.
- MongoDB's own docs warn: *"the semantic cache caches only the input to the LLM… documents
  retrieved can change between runs, resulting in cache misses."* So it keys on the **full
  prompt** (with injected patient data), not the patient's **question** — which both pollutes
  semantic matching and makes isolation depend on data happening to be in the prompt string.

**This conflicts with requirement #4 (per-patient isolation + matching on the question).**

### Decision: use the LangChain MongoDB building blocks, but a question-level cache with a patientId pre-filter
Two ways to stay within the LangChain integration while getting what we need:

- **✅ Option A (chosen): subclass `MongoDBAtlasSemanticCache`** — override `lookup`/`update`
  (and the `keyEncoder`) to (a) embed **only the user's question**, and (b) add `patientId`
  to the stored metadata and to the `preFilter`. Reuses LangChain's vector-store plumbing.
- *Contingency:* if the JS class internals don't cleanly permit injecting a `patientId`
  pre-filter, fall back to wrapping `MongoDBAtlasVectorSearch` directly (still LangChain).

We call the cache **explicitly at the question boundary** (not as a global `set_llm_cache`),
so intent-routing LLM calls don't pollute the patient cache. Reference: LangChain × MongoDB
[memory & semantic caching guide](https://www.mongodb.com/docs/atlas/ai-integrations/langchain/memory-semantic-cache/)
(Python tutorial; we use the equivalent `@langchain/mongodb` JS classes).

### `semantic_cache` document (proposed)
```jsonc
{
  "_id": "...",
  "patientId": "pat_0001",          // FILTER field (isolation)
  "scope": "patient",                // "patient" | "global"  (see two-tier idea below)
  "queryText": "how much of my deductible is left",
  "queryEmbedding": [ /* voyage-4-large 1024-dim vector */ ],  // VECTOR field
  "intent": "getDeductibleStatus",  // optional FILTER field
  "answer": "You have $1,150 of your $2,000 deductible remaining.",
  "sourceRefs": ["cov_0001"],        // provenance for debugging/invalidation
  "embeddingModel": "voyage-4-large",// FILTER — never match across model versions
  "createdAt": "...",
  "lastAccessedAt": "...",
  "hitCount": 0
  // No TTL/expiresAt for now (decision). Staleness handled by not caching volatile intents.
}
```

### Vector index (Atlas Vector Search)
```jsonc
{
  "fields": [
    { "type": "vector", "path": "queryEmbedding",
      "numDimensions": 1024, "similarity": "cosine" },  // voyage-4-large, cosine (per decision)
    { "type": "filter", "path": "patientId" },
    { "type": "filter", "path": "embeddingModel" },
    { "type": "filter", "path": "scope" }
  ]
}
```

### Lookup query (pre-filtered, top-1)
```javascript
db.semantic_cache.aggregate([
  { $vectorSearch: {
      index: "semantic_cache_vs",
      path: "queryEmbedding",
      queryVector: /* embedding of incoming question */,
      filter: { patientId: "pat_0001", embeddingModel: "voyage-3-large" },
      numCandidates: 100,
      limit: 1
  }},
  { $project: { answer: 1, intent: 1, score: { $meta: "vectorSearchScore" } } }
])
// Treat as a HIT only if score >= 0.90 (chosen threshold; tune from here).
```

### Key design decisions
- **Pre-filter on `patientId`** (not post-`$match`): faster (filters before similarity) and
  guarantees isolation. Answers containing patient specifics never leak across patients.
- **Similarity threshold = 0.90 (cosine).** Healthcare answers embed real numbers, so a
  near-miss should be a cache miss, not a wrong answer. 0.90 is our starting point; we'll tune
  against a test query set (raise if we see bad hits, lower if hit rate is too low).
- **Staleness / invalidation (no TTL for now — decision).** Cached answers embed data that
  changes (deductible met, refills remaining). Since we're not using a TTL index yet, we handle
  staleness by **not caching volatile intents** (e.g., `getDeductibleStatus`, `getRefillInfo`)
  and only caching stable/educational answers. (Future options if needed: reintroduce a TTL
  index, or a data-version stamp that invalidates a patient's entries on writes.)
- **Two-tier cache (enhancement).** Add a `scope: "global"` tier for **generic, non-PII
  educational** questions ("what is a deductible?") that can be safely shared across all
  patients — filter `scope: "global"` (ignoring patientId) for those. Personalized answers
  stay `scope: "patient"`. This raises hit rate without leaking anything private.
- **Embedding model versioning.** Always filter on `embeddingModel`; never compare vectors
  produced by different models/dimensions.

### Alternatives considered (and why pre-filter wins)
- *Separate collection per patient*: strong isolation but operationally silly and doesn't scale — rejected.
- *Post-filter with `$match`*: computes similarity on everyone's vectors first, slower, and risks accidental cross-patient exposure if mis-wired — rejected in favor of pre-filter.

---

## 7b. LLM integration (Grove gateway)

Grove is an OpenAI-compatible gateway using the **Responses API**. Verified with live calls:

- **Endpoint:** `POST https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1/responses`
- **Auth header:** `api-key: <GROVE_API_KEY>` (Azure APIM style — **not** `Authorization: Bearer`).
- **Model:** `gpt-5.5`. Request uses `input` (Responses API), response has `output[]` with `message` / `function_call` items.
- **Tool calling: confirmed working** — supplying `tools` + `tool_choice:"auto"` returned a
  `function_call` output with correctly parsed `arguments`. This validates the LLM tool-calling path.

**LangChain wiring (planned):** `ChatOpenAI` with
`configuration: { baseURL: ".../grove-foundry-prod/openai/v1", defaultHeaders: { "api-key": <key> } }`,
a dummy `apiKey`, and **`useResponsesApi: true`**. `AzureChatOpenAI` is a poor fit (Grove's path
isn't the standard Azure `deployments/...` shape), so we go with `ChatOpenAI` + custom base URL/header.

> **Confirmed:** Grove does **not** expose `/chat/completions` — Responses API only. So
> `useResponsesApi: true` is required (not optional) in the `ChatOpenAI` config.

## 8. Data Generation & Loading Plan

1. **Deterministic seed** (`faker.seed(...)`) for reproducible demos.
2. **Volume (small on purpose):** ~15–25 patients. Per patient: 1 coverage plan, 5–20 claims,
   3–10 prescriptions, a few conditions/allergies. Shared pool of ~15 providers.
3. **Curated code lists:** small hand-picked subsets of ICD-10, CPT/HCPCS, and NDC codes +
   matching drug names, so codes look real and map to human-readable descriptions.
4. **Consistency pass** (the important part): after generating, wire references so claims →
   providers + patient conditions, prescriptions → prescribers + respect allergies, and roll
   claim `patientResponsibility` into `coverage.deductible.met` / `outOfPocketMax.met`.
5. **Loader script** (`npm run seed`): connect → drop/recreate collections → insert →
   create regular indexes (`patientId`, etc.) → create **vector search index** on
   `semantic_cache` (and `intents` if used) via `createSearchIndex`.
6. **Embeddings for cache** start empty (populated at runtime). If we do the vector intent
   router, we pre-embed the `intents` example utterances at seed time.

---

## 9. Security / PHI posture (demo)

### 9.1 Secrets handling (kept OUT of the repo)
All credentials live in a **git-ignored** `.env` (never committed). The repo only contains
`.env.example` with **variable names and placeholders — no values**:

| Env var | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `GROVE_API_KEY` | Grove LLM gateway key (sent as `api-key` header) |
| `GROVE_BASE_URL` | `https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1` |
| `VOYAGE_API_KEY` | Voyage AI embeddings key |

- `.gitignore` excludes `.env*` (except `.env.example`) and `node_modules`.
- **Recommendation:** for cloud-agent runs, store these as **Cloud Agent Secrets** (Dashboard →
  Cloud Agents → Secrets) rather than pasting them, and since the current values were shared in
  plaintext, consider **rotating** them before/after the demo.

### 9.2 PHI posture
- All data synthetic — no real PHI.
- **Per-patient isolation** enforced everywhere: cache pre-filter, history queries, and the
  data the LLM sees are all scoped to the selected patient. No cross-patient context ever
  reaches the model.
- "Not medical advice" disclaimer in the UI and system prompt.
- Don't log full prompts/answers with data in plaintext beyond what the demo needs; redact IDs in logs.
- Patient "selection" screen is a demo convenience (no real auth) — call this out explicitly.

---

## 10. Open Questions / Decisions Needed Before Building

**All resolved.** Atlas ✅ · Grove `gpt-5.5` Responses API, tool-calling verified, no `/chat/completions` ✅ ·
Voyage `voyage-4-large` 1024-dim cosine ✅ · optional collections dropped ✅ · intent router + toggle ✅ ·
no TTL ✅ · cache = Plan A (subclass) ✅ · db `x42_agent` ✅ · threshold `0.90` ✅ ·
volatile intents = `getDeductibleStatus`/`getRefillInfo`/`getClaimStatus` ✅.

➡️ Ready to build. See **`docs/PHASED_PLAN.md`**.

---

## 11. Suggested Build Milestones (after this spec is approved)

1. Project scaffold (Next.js + TS) + MongoDB connection + env config.
2. Data model types + Faker generators + consistency pass + `seed` script.
3. Indexes (regular + vector search) creation script.
4. Patient selection screen + conversation history storage.
5. Embedding service (Voyage) + semantic cache read/write with pre-filter + threshold.
6. Tools + LLM orchestration (Grove tool-calling) + grounded answer generation.
7. Vector Search intent router + `INTENT_MODE` toggle (router ⇄ LLM) with confidence fallback.
8. Demo polish: "cached vs. generated" badge, deductible question, metrics (hit rate / tokens saved).
