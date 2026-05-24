import { config } from "dotenv";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEFAULT_PRESET_NAME } from "@wb-cleaner/shared-types";
import { rulesProfiles, type NewRulesProfile } from "../lib/db/schema";

config({ path: "../../.env" });
config({ path: ".env" });

const PRESETS: NewRulesProfile[] = [
  {
    name: DEFAULT_PRESET_NAME,
    isPreset: true,
    minViews: 40,
    minCtr: 2.5,
    weakCampaignCtr: 2.5,
    minCartsToProtect: 1,
    topKeepPct: 0.20,
    minClustersAlive: 3,
    bannedKeywords: ["dite"],
    useDynamicCtr: false,
    minDynamicCtr: 2.0,
  },
  {
    name: "Электроника",
    isPreset: true,
    minViews: 80,
    minCtr: 1.5,
    weakCampaignCtr: 1.5,
    minCartsToProtect: 1,
    topKeepPct: 0.25,
    minClustersAlive: 3,
    bannedKeywords: ["dite"],
    useDynamicCtr: false,
    minDynamicCtr: 2.0,
  },
  {
    name: "FMCG",
    isPreset: true,
    minViews: 60,
    minCtr: 3.5,
    weakCampaignCtr: 3.0,
    minCartsToProtect: 1,
    topKeepPct: 0.20,
    minClustersAlive: 3,
    bannedKeywords: ["dite"],
    useDynamicCtr: false,
    minDynamicCtr: 2.0,
  },
  {
    name: "Консервативный",
    isPreset: true,
    minViews: 100,
    minCtr: 1.0,
    weakCampaignCtr: 1.0,
    minCartsToProtect: 1,
    topKeepPct: 0.30,
    minClustersAlive: 5,
    bannedKeywords: ["dite"],
    useDynamicCtr: false,
    minDynamicCtr: 2.0,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sqlClient = postgres(url, { max: 1 });
  const db = drizzle(sqlClient, { schema: { rulesProfiles } });

  let inserted = 0;
  let updated = 0;

  for (const preset of PRESETS) {
    const existing = await db
      .select({ id: rulesProfiles.id })
      .from(rulesProfiles)
      .where(
        and(eq(rulesProfiles.isPreset, true), eq(rulesProfiles.name, preset.name)),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(rulesProfiles).values(preset);
      inserted++;
      console.log(`  + ${preset.name}`);
    } else {
      await db
        .update(rulesProfiles)
        .set({
          minViews: preset.minViews,
          minCtr: preset.minCtr,
          weakCampaignCtr: preset.weakCampaignCtr,
          minCartsToProtect: preset.minCartsToProtect,
          topKeepPct: preset.topKeepPct,
          minClustersAlive: preset.minClustersAlive,
          bannedKeywords: preset.bannedKeywords,
          useDynamicCtr: preset.useDynamicCtr,
          minDynamicCtr: preset.minDynamicCtr,
        })
        .where(eq(rulesProfiles.id, existing[0].id));
      updated++;
      console.log(`  ~ ${preset.name} (updated)`);
    }
  }

  console.log(`\nDone. inserted=${inserted}, updated=${updated}`);
  await sqlClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
