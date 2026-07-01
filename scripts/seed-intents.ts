import { seedIntents } from "../src/services/intents";
import { closeClient } from "../src/lib/mongo";

async function main() {
  console.log("=== seed-intents ===\n");
  const n = await seedIntents();
  console.log(`Embedded and stored ${n} intent example utterances.`);
  await closeClient();
}

main().catch(async (err) => {
  console.error("seed-intents failed:", err);
  await closeClient();
  process.exit(1);
});
