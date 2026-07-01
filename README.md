# x42-future-state

A demo **healthcare patient agent**: a chatbot where a patient asks questions about their
own **claims, prescriptions, and insurance coverage**, answered by an LLM grounded in data
stored in **MongoDB**. It showcases MongoDB for:

- **Operational data** (patients, providers, coverage, claims, prescriptions) — synthetic, generated with Faker.js.
- **Semantic cache** (Atlas Vector Search) — per-patient, question-level caching so repeat/paraphrased questions skip the LLM.
- **Intent routing** (Atlas Vector Search) — classify a question to an intent, then run that intent's **deterministic tool chain** (from a `tools` registry). Toggle between this vector router and free LLM tool-calling.
- **Conversation history** — per conversation (multiple conversations per patient).
- **Long-term memory** (Atlas Vector Search) — per-patient, cross-conversation memory of durable preferences, facts, and conversation summaries; recalled on each question and formed after each generated answer.

See [`docs/SPEC.md`](docs/SPEC.md) for the full design and [`docs/PHASED_PLAN.md`](docs/PHASED_PLAN.md) for the build plan.

## Architecture

- **Next.js + TypeScript** app (patient selection UI + chat).
- **MongoDB Atlas** (`x42_agent` db) with Vector Search indexes on `semantic_cache` and `intents`.
- **LangChain** (`@langchain/mongodb`) for the semantic cache, chat history, and Voyage embeddings.
- **Embeddings:** `voyage-4-large` (1024-dim, cosine) via the **Atlas Embedding API** (`https://ai.mongodb.com/v1`).
- **LLM:** Grove gateway `gpt-5.5` (OpenAI **Responses API**, tool-calling).

Request pipeline (`src/services/chat.ts`): semantic cache lookup (pre-filtered by `patientId`)
→ on miss, recall long-term memory (top-K vector search) → intent → patient-scoped MongoDB tools →
grounded answer → cache write (volatile intents skipped) → conversation history →
memory formation (extract durable preferences/facts + refresh summary) → metrics.

**Intent → tools (deterministic router):** in `router` mode, a vector search classifies the intent,
then we run that intent's **fixed, ordered tool chain** defined in the `tools` registry collection
(e.g. `getDeductibleStatus` → `resolvePatientContext` → `getCoverageByPatient` → `computeDeductibleStatus`).
Params like `claimId`/`drugName` are filled by a small constrained LLM extraction step; the LLM then
only synthesizes the final answer. Low-confidence classifications fall back to free LLM tool-calling
(`llm` mode). This makes the cache-miss path more deterministic than letting the model pick tools.

**Memory:** short-term = current conversation (recent turns). Long-term = `agent_memory`
(per-patient, cross-conversation) storing `preference` / `fact` / `summary` items with embeddings;
recalled on each question and injected into the prompt. Durable info only — never volatile figures
(deductible met, refill counts), which always come from tools.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in values (MongoDB URI, Grove key, Atlas Voyage key):
   ```bash
   cp .env.example .env
   ```
3. Seed data, create vector indexes, and seed intent examples:
   ```bash
   npm run seed            # patients/providers/coverage/claims/prescriptions
   npm run create-indexes  # vector search indexes (semantic_cache, intents, agent_memory)
   npm run seed-tools      # tools registry + intent example utterances (with tools[] mappings)
   ```

## Run

```bash
npm run dev     # http://localhost:3000
```

Pick a patient, then ask things like:
- "How much of my deductible have I met?"
- "Do I have any denied claims?"
- "How many refills do I have left?"

UI features:
- **Multiple conversations per patient** — a left sidebar to start a **new conversation** or revisit
  old ones. Chat history is per-conversation; the semantic cache is shared across a patient's conversations.
- **Behind-the-scenes panel** — a right-hand panel showing the step-by-step pipeline and the **actual
  MongoDB queries/aggregations/writes** for each response (e.g., the `$vectorSearch` on `semantic_cache`,
  the cache hit/miss decision, intent selection, tool queries, and the cache write). Click any answer to
  view its trace.
- **Intent mode toggle** (LLM tool-calling vs Vector router) and a **metrics panel** (cache hit rate,
  hits/misses, estimated tokens saved). Ask a paraphrase of an earlier question to see a cache hit.

## Verify / test each layer

| Command | Checks |
|---|---|
| `npm run healthcheck` | MongoDB + Grove + Voyage connectivity |
| `npm run verify-data` | seeded data integrity + deductible rollups |
| `npm run verify-indexes` | vector indexes queryable + pre-filter isolation |
| `npm run test-history` | per-patient history persistence + isolation |
| `npm run test-cache` | cache hit/paraphrase/isolation/volatile-skip |
| `npm run test-agent` | tool selection + grounded answers |
| `npm run test-intents` | intent classification + routing + fallback |
| `npm run test-tools` | tools registry integrity + deterministic tool-chain execution |
| `npm run test-params` | LLM parameter extraction (claimId/drugName) |
| `npm run test-integration` | full pipeline end-to-end + metrics |
| `npm run test-memory` | long-term memory formation, recall, isolation, dedup, skip-on-hit |

## Notes

- All data is **synthetic**. Not medical advice.
- Credentials live only in `.env` (git-ignored). For cloud runs, use Cloud Agent Secrets.
