"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";

interface Msg {
  role: "human" | "ai";
  content: string;
  cached?: boolean;
  intent?: string;
  mode?: string;
  score?: number;
  routed?: boolean;
}

interface Metrics {
  hits: number;
  misses: number;
  total: number;
  hitRate: number;
  estTokensSaved: number;
}

export default function ChatPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"llm" | "router">("llm");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMetrics = () =>
    fetch("/api/metrics").then((r) => r.json()).then(setMetrics).catch(() => {});

  useEffect(() => {
    fetch(`/api/history?patientId=${patientId}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.turns ?? []))
      .catch(() => {});
    loadMetrics();
  }, [patientId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "human", content: question }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, question, mode }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          content: data.answer ?? data.error ?? "(no response)",
          cached: data.cached,
          intent: data.intent,
          mode: data.mode,
          score: data.score,
          routed: data.routed,
        },
      ]);
      loadMetrics();
    } catch {
      setMessages((m) => [...m, { role: "ai", content: "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="topbar">
        <Link href="/" className="back-link">← Switch patient</Link>
        <div className="mode-toggle">
          <span className="muted">Intent mode:</span>
          {(["llm", "router"] as const).map((m) => (
            <button
              key={m}
              className={`chip ${mode === m ? "active" : ""}`}
              onClick={() => setMode(m)}
              disabled={busy}
            >
              {m === "llm" ? "LLM tool-calling" : "Vector router"}
            </button>
          ))}
        </div>
      </div>

      {metrics && (
        <div className="metrics">
          <div><span className="m-val">{(metrics.hitRate * 100).toFixed(0)}%</span><span className="m-lbl">cache hit rate</span></div>
          <div><span className="m-val">{metrics.hits}</span><span className="m-lbl">hits</span></div>
          <div><span className="m-val">{metrics.misses}</span><span className="m-lbl">misses (LLM calls)</span></div>
          <div><span className="m-val">~{metrics.estTokensSaved.toLocaleString()}</span><span className="m-lbl">est. tokens saved</span></div>
        </div>
      )}

      <div className="chat-wrap">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="muted">Ask about your claims, prescriptions, deductible, or providers.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content}
              {m.role === "ai" && m.cached !== undefined && (
                <div className="badges">
                  <span className={`badge ${m.cached ? "cached" : "generated"}`}>
                    {m.cached ? `cached${m.score ? ` (${m.score.toFixed(2)})` : ""}` : "generated"}
                  </span>
                  {m.intent && <span className="badge intent">{m.intent}</span>}
                  {m.mode && <span className="badge mode">{m.mode}{m.routed ? " · routed" : ""}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="e.g. How much of my deductible have I met?"
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
      <p className="disclaimer">Demo with synthetic data. Not medical advice.</p>
    </section>
  );
}
