export type TraceKind = "info" | "decision" | "embedding" | "mongo" | "llm";

export interface MongoOp {
  collection: string;
  operation: string; // find | aggregate | insertOne | updateOne | findOne ...
  query?: unknown; // filter / pipeline / document (embeddings redacted)
}

export interface TraceStep {
  n: number;
  kind: TraceKind;
  title: string;
  detail?: string;
  mongo?: MongoOp;
  data?: unknown;
}

/** Placeholder used in traced pipelines so we never dump a 1024-float vector to the UI. */
export const VECTOR_PLACEHOLDER = "<1024-dim query embedding>";

/**
 * Collects an ordered, human-readable trace of what the pipeline does — reasoning
 * steps plus the actual MongoDB operations — for display in the demo's query panel.
 */
export class Tracer {
  readonly steps: TraceStep[] = [];
  private counter = 0;

  private push(kind: TraceKind, title: string, extra: Partial<TraceStep> = {}): void {
    this.steps.push({ n: ++this.counter, kind, title, ...extra });
  }

  info(title: string, detail?: string): void {
    this.push("info", title, { detail });
  }

  decision(title: string, detail?: string): void {
    this.push("decision", title, { detail });
  }

  embedding(title: string, detail?: string): void {
    this.push("embedding", title, { detail });
  }

  llm(title: string, detail?: string, data?: unknown): void {
    this.push("llm", title, { detail, data });
  }

  mongo(op: MongoOp, title?: string, detail?: string): void {
    this.push("mongo", title ?? `${op.operation} on ${op.collection}`, { detail, mongo: op });
  }
}
