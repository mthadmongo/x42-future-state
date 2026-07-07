import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { COLLECTIONS } from "../config";
import { getDb } from "../lib/mongo";
import { clearMessages } from "./history";

const DEFAULT_TITLE = "New conversation";

export interface Conversation {
  id: string;
  patientId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function toConversation(doc: Document): Conversation {
  return {
    id: doc._id as string,
    patientId: doc.patientId as string,
    title: (doc.title as string) ?? DEFAULT_TITLE,
    createdAt: (doc.createdAt as Date)?.toISOString?.() ?? String(doc.createdAt),
    updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? String(doc.updatedAt),
  };
}

export async function createConversation(patientId: string): Promise<Conversation> {
  const db = await getDb();
  const now = new Date();
  const doc: Document = {
    _id: randomUUID(),
    patientId,
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(COLLECTIONS.conversations).insertOne(doc);
  return toConversation(doc);
}

export async function listConversations(patientId: string): Promise<Conversation[]> {
  const db = await getDb();
  const docs = await db
    .collection(COLLECTIONS.conversations)
    .find({ patientId })
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map(toConversation);
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const db = await getDb();
  const doc = await db.collection(COLLECTIONS.conversations).findOne({ _id: conversationId as any });
  return doc ? toConversation(doc) : null;
}

/** Bump updatedAt; set the title from the first user message if still default. */
export async function touchConversation(conversationId: string, firstUserMessage?: string): Promise<void> {
  const db = await getDb();
  const set: Document = { updatedAt: new Date() };
  if (firstUserMessage) {
    const existing = await db.collection(COLLECTIONS.conversations).findOne({ _id: conversationId as any });
    if (existing && (!existing.title || existing.title === DEFAULT_TITLE)) {
      set.title = firstUserMessage.slice(0, 60);
    }
  }
  await db.collection(COLLECTIONS.conversations).updateOne({ _id: conversationId as any }, { $set: set });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = await getDb();
  await db.collection(COLLECTIONS.conversations).deleteOne({ _id: conversationId as any });
  await clearMessages(conversationId);
}
