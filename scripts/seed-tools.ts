import { seedTools } from "../src/services/toolRegistry";
import { seedIntents } from "../src/services/intents";
import { closeClient } from "../src/lib/mongo";

async function main() {
  console.log("=== seed-tools ===\n");
  const nTools = await seedTools();
  console.log(`Seeded ${nTools} atomic tool definitions into the tools collection.`);
  // Re-seed intents so each intent document carries its tools[] mapping.
  const nIntents = await seedIntents();
  console.log(`Re-seeded ${nIntents} intent example utterances with tools[] mappings.`);
  await closeClient();
}

main().catch(async (err) => {
  console.error("seed-tools failed:", err);
  await closeClient();
  process.exit(1);
});
