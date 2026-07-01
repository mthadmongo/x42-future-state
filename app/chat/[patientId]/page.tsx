"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";

interface MongoOp {
  collection: string;
  operation: string;
  query?: unknown;
}
interface TraceStep {
  n: number;
  kind: "info" | "decision" | "embedding" | "mongo" | "llm";
  title: string;
  detail?: string;
  mongo?: MongoOp;
}
interface Msg {
  role: "human" | "ai";
  content: string;
  cached?: boolean;
  intent?: string;
  mode?: string;
  score?: number;
  routed?: boolean;
  trace?: TraceStep[];
}
interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"llm" | "router">("llm");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [trace, setTrace] = useState<TraceStep[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMetrics = useCallback(
    () => fetch("/api/metrics").then((r) => r.json()).then(setMetrics).catch(() => {}),
    [],
  );
  const loadConversations = useCallback(
    () =>
      fetch(`/api/conversations?patientId=${patientId}`)
        .then((r) => r.json())
        .then((d) => d.conversations as Conversation[]),
    [patientId],
  );
  const loadHistory = useCallback((conversationId: string) => {
    fetch(`/api/history?conversationId=${conversationId}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.turns ?? []))
      .catch(() => {});
  }, []);

  // Initial load: conversations (create one if none), metrics.
  useEffect(() => {
    (async () => {
      let convos = await loadConversations();
      if (convos.length === 0) {
        const { conversation } = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId }),
        }).then((r) => r.json());
        convos = [conversation];
      }
      setConversations(convos);
      setActiveId(convos[0].id);
      loadHistory(convos[0].id);
    })();
    loadMetrics();
  }, [patientId, loadConversations, loadHistory, loadMetrics]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function newConversation() {
    const { conversation } = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientId }),
    }).then((r) => r.json());
    setConversations((c) => [conversation, ...c]);
    setActiveId(conversation.id);
    setMessages([]);
    setTrace(null);
  }

  function selectConversation(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setTrace(null);
    loadHistory(id);
  }

  async function send() {
    const question = input.trim();
    if (!question || busy || !activeId) return;
    setInput("");
    setMessages((m) => [...m, { role: "human", content: question }]);
    setBusy(true);
    try {
      const data = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, conversationId: activeId, question, mode }),
      }).then((r) => r.json());
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
          trace: data.trace,
        },
      ]);
      setTrace(data.trace ?? null);
      loadMetrics();
      loadConversations().then(setConversations);
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
            <button key={m} className={`chip ${mode === m ? "active" : ""}`} onClick={() => setMode(m)} disabled={busy}>
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

      <div className="chat-layout">
        {/* Conversations rail */}
        <aside className="rail">
          <button className="new-convo" onClick={newConversation} disabled={busy}>+ New conversation</button>
          <h3>Conversations</h3>
          {conversations.map((c) => (
            <div key={c.id} className={`convo ${c.id === activeId ? "active" : ""}`} onClick={() => selectConversation(c.id)}>
              <div className="c-title">{c.title}</div>
              <div className="c-time">{new Date(c.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </aside>

        {/* Chat */}
        <div className="chat-wrap">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="muted">Ask about your claims, prescriptions, deductible, or providers.</div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`bubble ${m.role}`}
                onClick={() => m.trace && setTrace(m.trace)}
                style={m.trace ? { cursor: "pointer" } : undefined}
                title={m.trace ? "Click to view this response's trace" : undefined}
              >
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
            <button onClick={send} disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</button>
          </div>
        </div>

        {/* Behind the scenes / query panel */}
        <aside className="trace">
          <h3>Behind the scenes</h3>
          {!trace || trace.length === 0 ? (
            <div className="trace-empty">Send a message to see the step-by-step pipeline and the MongoDB queries it runs.</div>
          ) : (
            trace.map((s) => (
              <div key={s.n} className={`trace-step k-${s.kind}`}>
                <div className="ts-head">{s.n}. {s.title}<span className="ts-kind">{s.kind}</span></div>
                {s.detail && <div className="ts-detail">{s.detail}</div>}
                {s.mongo && (
                  <div className="ts-mongo">
                    <div className="ns">db.{s.mongo.collection}.{s.mongo.operation}()</div>
                    {s.mongo.query !== undefined && <pre>{JSON.stringify(s.mongo.query, null, 2)}</pre>}
                  </div>
                )}
              </div>
            ))
          )}
        </aside>
      </div>
      <p className="disclaimer">Demo with synthetic data. Not medical advice.</p>
    </section>
  );
}
