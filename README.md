# x42-future-state

A demo **healthcare patient agent**: a chatbot where a patient asks questions about their
own **claims, prescriptions, and insurance coverage**, answered by an LLM grounded in data
stored in **MongoDB**. It showcases MongoDB for:

- **Operational data** (patients, providers, coverage, claims, prescriptions) — synthetic, generated with Faker.js.
- **Semantic cache** (Atlas Vector Search) — per-patient, question-level caching so repeat/paraphrased questions skip the LLM.
- **Intent routing** (Atlas Vector Search) — classify a question to a tool; toggle between the vector router and LLM tool-calling.
- **Conversation history** — per patient.

See [`docs/SPEC.md`](docs/SPEC.md) for the full design and [`docs/PHASED_PLAN.md`](docs/PHASED_PLAN.md) for the build plan.

## Architecture

- **Next.js + TypeScript** app (patient selection UI + chat).
- **MongoDB Atlas** (`x42_agent` db) with Vector Search indexes on `semantic_cache` and `intents`.
- **LangChain** (`@langchain/mongodb`) for the semantic cache, chat history, and Voyage embeddings.
- **Embeddings:** `voyage-4-large` (1024-dim, cosine) via the **Atlas Embedding API** (`https://ai.mongodb.com/v1`).
- **LLM:** Grove gateway `gpt-5.5` (OpenAI **Responses API**, tool-calling).

Request pipeline (`src/services/chat.ts`): semantic cache lookup (pre-filtered by `patientId`)
→ on miss, intent (vector router or LLM tool-calling) → patient-scoped MongoDB tools → grounded
answer → cache write (volatile intents skipped) → conversation history → metrics.

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
   npm run create-indexes  # vector search indexes (semantic_cache, intents)
   npm run seed-intents    # embed intent example utterances
   ```

## Run

```bash
npm run dev     # http://localhost:3000
```

Pick a patient, then ask things like:
- "How much of my deductible have I met?"
- "Do I have any denied claims?"
- "How many refills do I have left?"

Toggle **LLM tool-calling** vs **Vector router** in the chat header; watch the **cache hit rate**
and **estimated tokens saved** in the metrics panel. Ask a paraphrase of an earlier question to
see a cache hit.

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
| `npm run test-integration` | full pipeline end-to-end + metrics |

## Notes

- All data is **synthetic**. Not medical advice.
- Credentials live only in `.env` (git-ignored). For cloud runs, use Cloud Agent Secrets.
