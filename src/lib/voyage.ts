import { config } from "../config";

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  model?: string;
  detail?: string;
}

export type VoyageInputType = "query" | "document";

/**
 * Embeds one or more texts via the Atlas Embedding API (Voyage models).
 * Returns one 1024-dim vector per input (cosine-normalized model output).
 *
 * `inputType` optimizes retrieval embeddings. For the semantic cache we compare
 * question-to-question, so we use a single consistent type for symmetry.
 */
export async function embed(
  inputs: string | string[],
  inputType: VoyageInputType = "query",
): Promise<number[][]> {
  const input = Array.isArray(inputs) ? inputs : [inputs];

  const res = await fetch(`${config.voyage.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.voyage.apiKey}`,
    },
    body: JSON.stringify({
      input,
      model: config.voyage.model,
      input_type: inputType,
      output_dimension: config.voyage.dimensions,
    }),
  });

  const json = (await res.json()) as VoyageEmbeddingResponse;
  if (!res.ok || !json.data) {
    throw new Error(
      `Voyage embedding failed (${res.status}): ${json.detail ?? JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedOne(
  text: string,
  inputType: VoyageInputType = "query",
): Promise<number[]> {
  const [vec] = await embed(text, inputType);
  return vec;
}
