import { VoyageEmbeddings } from "@langchain/mongodb";
import { config } from "../config";

/**
 * LangChain Embeddings pointed at the Atlas Embedding API (Voyage models).
 * `basePath` routes to https://ai.mongodb.com/v1 since the key is an Atlas model API key.
 */
export const embeddings = new VoyageEmbeddings({
  apiKey: config.voyage.apiKey,
  basePath: config.voyage.baseUrl,
  modelName: config.voyage.model,
  outputDimension: config.voyage.dimensions,
  inputType: "query",
});
