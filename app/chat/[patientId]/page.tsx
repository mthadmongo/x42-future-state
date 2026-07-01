"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { use } from "react";

interface Msg {
  role: "human" | "ai";
  content: string;
  cached?: boolean;
  intent?: string;
}

export default function ChatPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = use(params);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/history?patientId=${patientId}`)
      .then((r) => r.json())
      .then((d) => setMessages(d.turns ?? []))
      .catch(() => {});
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
        body: JSON.stringify({ patientId, question }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "ai", content: data.answer ?? data.error ?? "(no response)", cached: data.cached, intent: data.intent },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "ai", content: "Something went wrong." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <Link href="/" className="back-link">← Switch patient</Link>
      <h1>Chat</h1>
      <div className="chat-wrap">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="muted">Ask about your claims, prescriptions, deductible, or providers.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content}
              {m.role === "ai" && m.cached !== undefined && (
                <span className={`badge ${m.cached ? "cached" : "generated"}`}>
                  {m.cached ? "cached" : "generated"}
                </span>
              )}
              {m.role === "ai" && m.intent && <span className="badge intent">{m.intent}</span>}
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
      <p className="disclaimer">
        Demo with synthetic data. Not medical advice.
      </p>
    </section>
  );
}
