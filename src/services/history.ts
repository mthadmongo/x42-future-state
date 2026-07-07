import { MongoDBChatMessageHistory } from "@langchain/mongodb";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";

export interface ChatTurn {
  role: "human" | "ai";
  content: string;
}

/**
 * Messages for a single conversation, via LangChain's MongoDBChatMessageHistory.
 * The session id IS the conversationId (globally unique), stored in
 * `conversation_messages`. Conversation metadata lives in `conversations`
 * (see conversations.ts).
 */
export async function getHistory(conversationId: string): Promise<MongoDBChatMessageHistory> {
  const db = await getDb();
  return new MongoDBChatMessageHistory({
    collection: db.collection(COLLECTIONS.conversationMessages),
    sessionId: conversationId,
  });
}

export async function appendTurn(conversationId: string, role: "human" | "ai", content: string): Promise<void> {
  const history = await getHistory(conversationId);
  const message: BaseMessage = role === "human" ? new HumanMessage(content) : new AIMessage(content);
  await history.addMessage(message);
}

export async function getTurns(conversationId: string): Promise<ChatTurn[]> {
  const history = await getHistory(conversationId);
  const messages = await history.getMessages();
  return messages.map((m) => ({
    role: m.getType() === "human" ? "human" : "ai",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}

export async function clearMessages(conversationId: string): Promise<void> {
  const history = await getHistory(conversationId);
  await history.clear();
}
