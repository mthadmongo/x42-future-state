# Phased Development Plan — x42 Healthcare Patient Agent

Companion to `docs/SPEC.md`. The build is split into **8 phases**. Each phase is small enough
to **test and debug in isolation** before moving on. Every phase lists: **Goal → Deliverables →
How to test → Debug checklist → Exit criteria.**

**Working agreement per phase:** implement → run the phase's test → debug until the exit criteria
pass → **commit + push + update the PR** → only then start the next phase. Do not build a later
phase on top of an unverified earlier one.

**Global conventions**
- DB: **`x42_agent`** (all collections). Config via `.env` (git-ignored; see `.env.example`).
- Stack: Next.js + TS, `mongodb` driver, `langchain` / `@langchain/mongodb` / `@langchain/openai`, Voyage embeddings.
- Each phase adds an entry to a lightweight `scripts/` smoke test so tests are repeatable.

---

## Phase 0 — Scaffold & Connectivity
**Goal:** Prove we can reach all three external systems before writing any business logic.

**Deliverables**
- Next.js + TS + Tailwind scaffold; env loading (`MONGODB_URI`, `MONGODB_DB`, `GROVE_*`, `VOYAGE_*`).
- Thin clients: `lib/mongo.ts` (driver → `x42_agent`), `lib/grove.ts` (`ChatOpenAI` w/ custom `baseURL` + `api-key` header + `useResponsesApi: true`), `lib/voyage.ts` (Voyage embeddings, `voyage-4-large`, 1024).
- `scripts/healthcheck.ts` (`npm run healthcheck`).

**How to test** — run `npm run healthcheck`, which:
1. Connects to Mongo and lists collections in `x42_agent`.
2. Sends a "hello" to Grove and prints the text output.
3. Embeds a test string via Voyage and asserts vector length **== 1024**.

**Debug checklist**
- Grove 401 → verify `api-key` header (not `Authorization: Bearer`) and base URL ends in `/openai/v1`.
- Grove 404 → confirm `useResponsesApi: true` (only `/responses` exists).
- Mongo timeout → Atlas IP allowlist / SRV string.
- Voyage dims ≠ 1024 → confirm model `voyage-4-large` + `outputDimension: 1024`.

**Exit criteria:** all three checks pass and print expected output.

---

## Phase 1 — Data Model + Synthetic Data + Loader
**Goal:** Reproducible, internally consistent synthetic dataset in `x42_agent`.

**Deliverables**
- TS types for `patients`, `providers`, `coverage`, `claims`, `prescriptions`.
- Curated code lists (small ICD-10 / CPT / NDC + drug-name subsets).
- Faker generators (seeded) + **consistency pass** (claims→providers, rx→prescriber, diagnosis codes valid, claim `patientResponsibility` rolls up into `coverage.deductible.met`/`outOfPocketMax.met`).
- `scripts/seed.ts` (`npm run seed`): drop/recreate collections → insert → create **regular** indexes (`patientId`, `claims.status`, `prescriptions.status`, etc.).

**How to test** — `scripts/verify-data.ts`:
- Counts per collection are non-zero and sane (~15–25 patients).
- For a sampled patient: every `claim.providerId`/`rx.prescriberId` resolves to a real provider; `sum(patientResponsibility)` ≤ `coverage.deductible.individual` and equals `deductible.met`.
- Re-running `seed` with the same seed yields identical `_id`s (reproducibility).

**Debug checklist**
- Broken references → run consistency pass **after** all entities exist.
- Deductible mismatch → recompute rollup as the final seed step.
- Non-reproducible ids → ensure `faker.seed()` set once before generation.

**Exit criteria:** `verify-data.ts` passes all assertions; seed is reproducible.

---

## Phase 2 — Indexes (regular + Vector Search)
**Goal:** Vector Search indexes exist and are queryable.

**Deliverables**
- `scripts/create-indexes.ts`: create vector search indexes via `createSearchIndex`:
  - `semantic_cache`: vector `queryEmbedding` (1024, **cosine**) + filter `patientId`, `embeddingModel`, `scope`.
  - `intents`: vector `embedding` (1024, cosine) + filter fields as needed.
- Poll until index status is `READY`.

**How to test**
- Insert 2–3 dummy vectors, run a `$vectorSearch` with a `patientId` pre-filter, confirm results + `vectorSearchScore`, then clean up.
- Confirm index status `READY` (or `ACTIVE`) via `listSearchIndexes`.

**Debug checklist**
- `Path needs to be indexed as token` → the filter field wasn't declared as `type: "filter"`.
- Empty results → index still building, or dimension mismatch (must be 1024).
- Wrong scores → verify `similarity: "cosine"`.

**Exit criteria:** dummy pre-filtered `$vectorSearch` returns expected rows; indexes `READY`.

---

## Phase 3 — Patient Selection + Conversation History
**Goal:** Pick a patient; persist per-patient conversation.

**Deliverables**
- UI: patient-selection screen (list from `patients`) → sets active `patientId`/session.
- History via `MongoDBChatMessageHistory` (keyed by `session_id = patientId`), collection in `x42_agent`.
- Chat shell UI (send message, render history).

**How to test**
- Select patient A, send messages, reload → history persists.
- Select patient B → sees only B's history (isolation).

**Debug checklist**
- History bleed across patients → session key must include `patientId`.
- Not persisting → confirm collection/db name and write success.

**Exit criteria:** per-patient history persists and is isolated across patients.

---

## Phase 4 — Embeddings + Semantic Cache (Plan A)
**Goal:** Per-patient, question-level semantic cache with `patientId` pre-filter.

**Deliverables**
- Voyage embedding wrapper (reused from Phase 0).
- **Subclass `MongoDBAtlasSemanticCache`** (Plan A): override `lookup`/`update` (+ `keyEncoder`) to
  embed **only the question**, store/pre-filter on `patientId`, apply threshold **0.90**, tag `scope`
  (`patient`|`global`) and `embeddingModel`. **Skip caching volatile intents**
  (`getDeductibleStatus`, `getRefillInfo`, `getClaimStatus`).
- Called **explicitly at the question boundary** (not global `set_llm_cache`).

**How to test** (`scripts/test-cache.ts`, with a stub answer generator)
1. Same question twice, same patient → 2nd is a **HIT** (score ≥ 0.90; note latency drop).
2. Paraphrased question, same patient → HIT.
3. Same question, **different** patient → **MISS** (isolation proven).
4. A volatile-intent question → **never cached**.

**Debug checklist**
- Cross-patient hit → pre-filter not applied / `patientId` not in index filter fields.
- Never hits → threshold too high, or embedding the full prompt instead of just the question.
- Subclass can't inject pre-filter → invoke contingency (wrap `MongoDBAtlasVectorSearch`).

**Exit criteria:** hit/miss + isolation + volatile-skip all behave as specified.

---

## Phase 5 — Tools + LLM Orchestration (Grove) + Grounded Answers
**Goal:** Answer real questions from patient data via LLM tool-calling.

**Deliverables**
- Tools → MongoDB queries: `getClaims`, `getClaimStatus`, `getCoverageSummary`, `getDeductibleStatus`,
  `getPrescriptions`, `getRefillInfo`, `getProviderInfo`, `generalHealthEducation`.
- Grove tool-calling loop (Responses API): model picks tool → execute query → feed results back → grounded answer + "not medical advice" disclaimer. All queries scoped to active `patientId`.

**How to test** — a fixed question set with expected facts:
- "How much of my deductible have I met?" → matches `coverage.deductible.met`.
- "Show my denied claims" / "How many refills left on X?" / compound ("denied claims **and** refills").
- Answers only reference the active patient's data.

**Debug checklist**
- No tool call → check tool JSON schema + `tool_choice:"auto"`.
- Hallucinated numbers → ensure answer is grounded strictly in tool results; tighten system prompt.
- Cross-patient leak → every tool query must filter by active `patientId`.

**Exit criteria:** question set answered correctly and grounded; no cross-patient leakage.

---

## Phase 6 — Intent Router + Toggle
**Goal:** Vector Search intent routing, switchable with LLM tool-calling.

**Deliverables**
- Seed `intents` with labeled example utterances per intent; pre-embed at seed time.
- Router: embed query → `$vectorSearch` over `intents` → nearest intent; **confidence fallback** to LLM below a threshold.
- `INTENT_MODE` toggle (`llm` | `router`) surfaced in config + UI.

**How to test**
- Labeled test utterances route to expected intents in `router` mode.
- Toggle to `llm` mode → same questions still handled.
- Low-confidence/ambiguous query → falls back to LLM.

**Debug checklist**
- Misroutes → add/curate example utterances; check score distribution to set fallback threshold.
- Multi-intent handled poorly in router mode → expected; rely on LLM fallback/mode.

**Exit criteria:** both modes work; toggle switches cleanly; fallback triggers on low confidence.

---

## Phase 7 — Full Integration + Demo Polish
**Goal:** End-to-end demo, wired and presentable.

**Deliverables**
- Full request flow: select patient → embed question → **cache lookup** → (miss) **intent** → **tools** → **grounded answer** → **cache write** → **history append**.
- UI polish: "cached vs. generated" badge; metrics panel (cache hit rate, tokens/latency saved); disclaimer; demo script.

**How to test**
- Full demo walkthrough incl. the deductible question and a cache-hit repeat.
- Cross-patient isolation verified end-to-end (cache + history + tool data).
- Metrics update correctly on hits vs. misses.

**Debug checklist**
- Cache writing volatile intents → confirm skip logic on the integrated path.
- Metrics wrong → verify hit/miss accounting at the cache boundary.

**Exit criteria:** demo runs start-to-finish; isolation holds; metrics accurate.

---

## Cross-cutting tests carried through every phase
- **Isolation:** no patient ever sees another patient's cache, history, or data.
- **Reproducibility:** `seed` is deterministic.
- **Secrets:** `.env` never committed; scan tracked files before each push.
- **Repeatability:** each phase's smoke test remains runnable as later phases land.
