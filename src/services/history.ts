import { MongoDBChatMessageHistory } from "@langchain/mongodb";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";

export interface ChatTurn {
  role: "human" | "ai";
  content: string;
}

/**
 * Per-patient conversation history. The LangChain session id IS the patientId,
 * so history is isolated per patient (requirement #4).
 */
export async function getHistory(patientId: string): Promise<MongoDBChatMessageHistory> {
  const db = await getDb();
  return new MongoDBChatMessageHistory({
    collection: db.collection(COLLECTIONS.conversations),
    sessionId: patientId,
  });
}

export async function appendTurn(patientId: string, role: "human" | "ai", content: string): Promise<void> {
  const history = await getHistory(patientId);
  const message: BaseMessage = role === "human" ? new HumanMessage(content) : new AIMessage(content);
  await history.addMessage(message);
}

export async function getTurns(patientId: string): Promise<ChatTurn[]> {
  const history = await getHistory(patientId);
  const messages = await history.getMessages();
  return messages.map((m) => ({
    role: m.getType() === "human" ? "human" : "ai",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}

export async function clearHistory(patientId: string): Promise<void> {
  const history = await getHistory(patientId);
  await history.clear();
}
