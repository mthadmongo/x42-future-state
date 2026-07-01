import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}. See .env.example.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const config = {
  mongo: {
    uri: required("MONGODB_URI"),
    db: optional("MONGODB_DB", "x42_agent"),
  },
  grove: {
    apiKey: required("GROVE_API_KEY"),
    baseUrl: optional(
      "GROVE_BASE_URL",
      "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1",
    ),
    model: optional("GROVE_MODEL", "gpt-5.5"),
  },
  voyage: {
    apiKey: required("VOYAGE_API_KEY"),
    // Atlas-native Voyage embedding endpoint (model API keys route here).
    baseUrl: optional("VOYAGE_BASE_URL", "https://ai.mongodb.com/v1"),
    model: optional("VOYAGE_MODEL", "voyage-4-large"),
    dimensions: Number(optional("VOYAGE_DIMENSIONS", "1024")),
  },
  agent: {
    intentMode: optional("INTENT_MODE", "llm") as "llm" | "router",
    cacheSimilarityThreshold: Number(optional("CACHE_SIMILARITY_THRESHOLD", "0.90")),
  },
} as const;

export const COLLECTIONS = {
  patients: "patients",
  providers: "providers",
  coverage: "coverage",
  claims: "claims",
  prescriptions: "prescriptions",
  conversations: "conversations",
  semanticCache: "semantic_cache",
  intents: "intents",
} as const;

export const VECTOR_INDEXES = {
  semanticCache: "semantic_cache_vs",
  intents: "intents_vs",
} as const;

export const VECTOR_FIELDS = {
  semanticCache: "queryEmbedding",
  intents: "embedding",
} as const;
