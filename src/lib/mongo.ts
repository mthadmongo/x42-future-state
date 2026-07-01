import { MongoClient, type Db } from "mongodb";
import { config } from "../config.js";

let client: MongoClient | null = null;

export async function getClient(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(config.mongo.uri, {
      serverSelectionTimeoutMS: 15000,
    });
    await client.connect();
  }
  return client;
}

export async function getDb(): Promise<Db> {
  const c = await getClient();
  return c.db(config.mongo.db);
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
