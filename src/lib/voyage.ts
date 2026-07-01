import { config } from "../config.js";

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  model?: string;
  detail?: string;
}

/**
 * Embeds one or more texts via the Voyage AI API. Returns one 1024-dim vector
 * per input (cosine-normalized model output).
 */
export async function embed(inputs: string | string[]): Promise<number[][]> {
  const input = Array.isArray(inputs) ? inputs : [inputs];

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.voyage.apiKey}`,
    },
    body: JSON.stringify({
      input,
      model: config.voyage.model,
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

export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed(text);
  return vec;
}
