import { canonicalFieldName, containsAny } from "@/lib/canonical";
import type { GameIntake, GeneratedEvent, GeneratedSpec, LibrarySnapshot } from "@/lib/types";

const PACKS = {
  core: "Core Gameplay Round",
  economy: "Economy Transactions",
  iap: "Store / IAP Funnel",
  liveOps: "Live Ops",
  rewarded: "Rewarded Ads / IAA Rewards",
  platformAds: "Platform Ad Payload Enrichment",
};

export function selectFeaturePacks(intake: GameIntake) {
  const text = [
    intake.genre,
    intake.coreLoop,
    intake.gameModes,
    intake.mechanics,
    intake.winConditions,
    intake.loseConditions,
    intake.economy,
    intake.itemsOrPowerups,
    intake.powerupNames,
    intake.iap,
    intake.ads,
    intake.rewardedAdPlacements,
    intake.interstitialAdPlacements,
    intake.liveOps,
    intake.notes,
  ].join(" ");

  const packs = new Set<string>([PACKS.core]);

  if (
    containsAny(text, [
      "currency",
      "coin",
      "coins",
      "economy",
      "booster",
      "powerup",
      "power-up",
      "item",
      "inventory",
      "life",
      "lives",
      "purchase",
      "spend",
      "earn",
      "revive",
      "play-on",
      "playon",
    ])
  ) {
    packs.add(PACKS.economy);
  }

  if (containsAny(text, ["iap", "store", "shop", "bundle", "product", "paid"])) {
    packs.add(PACKS.iap);
  }

  if (containsAny(text, ["live ops", "liveops", "event", "season", "mission", "milestone", "daily challenge", "leaderboard"])) {
    packs.add(PACKS.liveOps);
  }

  const selectedAds = new Set(splitValues(intake.ads));

  if (selectedAds.has("Rewarded Ads") || containsAny(text, ["rewarded", "reward video", "rv", "ad_reward", "2x_reward", "daily_reward"])) {
    packs.add(PACKS.rewarded);
  }

  if (selectedAds.has("Rewarded Ads") || selectedAds.has("Interstitial Ads")) {
    packs.add(PACKS.platformAds);
  }

  if (!selectedAds.has("Rewarded Ads") && !selectedAds.has("Interstitial Ads") && !containsAny(text, ["ad", "ads", "interstitial", "rewarded", "rv"])) {
    packs.delete(PACKS.platformAds);
    packs.delete(PACKS.rewarded);
  }

  return [...packs];
}

function splitValues(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function powerupSlugs(intake: GameIntake) {
  return splitValues(intake.powerupNames)
    .map(slugify)
    .filter(Boolean);
}

function intakeText(intake: GameIntake) {
  return [
    intake.genre,
    intake.coreLoop,
    intake.gameModes,
    intake.mechanics,
    intake.winConditions,
    intake.loseConditions,
    intake.economy,
    intake.itemsOrPowerups,
    intake.powerupNames,
    intake.iap,
    intake.ads,
    intake.rewardedAdPlacements,
    intake.interstitialAdPlacements,
    intake.liveOps,
    intake.notes,
  ].join(" ");
}

function hasMechanic(intake: GameIntake, label: string) {
  return splitValues(intake.mechanics).some((mechanic) => mechanic.toLowerCase() === label.toLowerCase());
}

function hasEconomyOption(intake: GameIntake, label: string) {
  return splitValues(intake.economy).some((option) => option.toLowerCase() === label.toLowerCase());
}

function itemTransactionExamples(intake: GameIntake) {
  const examples = [
    ...powerupSlugs(intake).map((name) => `powerup_${name}`),
    hasMechanic(intake, "Revive") ? "revive" : "",
    hasMechanic(intake, "Play-on") ? "playon" : "",
    hasEconomyOption(intake, "Lives / energy") ? "lives" : "",
  ].filter(Boolean);
  return [...new Set(examples)].map((item) => `"${item}"`).join(", ");
}

function shouldIncludeEvent(eventName: string, intake: GameIntake) {
  const text = intakeText(intake);
  if (eventName === "Currency_Transaction") {
    return hasEconomyOption(intake, "Currency") || containsAny(text, ["currency", "coin", "coins"]);
  }
  if (eventName === "Item_Transaction") {
    return (
      hasEconomyOption(intake, "Item inventory") ||
      hasEconomyOption(intake, "Lives / energy") ||
      hasMechanic(intake, "Powerups") ||
      hasMechanic(intake, "Revive") ||
      hasMechanic(intake, "Play-on") ||
      Boolean(powerupSlugs(intake).length) ||
      containsAny(text, ["item inventory", "inventory", "life", "lives", "powerup", "power-up"])
    );
  }
  return true;
}

function shouldIncludePayload(fieldName: string, eventName: string, intake: GameIntake) {
  const field = canonicalFieldName(fieldName);
  const text = intakeText(intake);
  const hasPowerups = hasMechanic(intake, "Powerups") || Boolean(powerupSlugs(intake).length);
  const alwaysExcludedFields = new Set([
    "game_end_reason",
    "illegal_regions",
    "revives_delivery_failed_used",
    "revives_out_of_time_used",
    "playon_delivery_failed_used",
    "playon_out_of_time_used",
    "worms_target",
  ]);

  if (alwaysExcludedFields.has(field)) return false;

  const optionalFields: Record<string, boolean> = {
    difficulty: hasMechanic(intake, "Difficulty tiers"),
    move_count: hasMechanic(intake, "Limited moves"),
    time_limit: hasMechanic(intake, "Limited time"),
    time_per_match: hasMechanic(intake, "Match objectives"),
    match_done: hasMechanic(intake, "Match objectives"),
    powerup_used: hasPowerups,
    rv_powerup_used: hasPowerups,
    revives_used: hasMechanic(intake, "Revive"),
    playons_used: hasMechanic(intake, "Play-on"),
    extra_grill_used: containsAny(text, ["extra grill", "extra slot"]),
    skip_delivery_used: containsAny(text, ["skip delivery", "skip objective"]),
    possible_matches: containsAny(text, ["possible matches"]),
  };

  if (/^powerup_.+_used$/.test(field)) return hasPowerups;
  if (field in optionalFields) return optionalFields[field];

  if (eventName !== "Game_Start" && eventName !== "Game_End") {
    if (field === "move_count") return hasMechanic(intake, "Limited moves");
  }

  return true;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function adFamiliesForIntake(intake: GameIntake) {
  const selectedAds = new Set(splitValues(intake.ads));
  const families = new Set<string>();
  if (selectedAds.has("Rewarded Ads")) families.add("Rewarded");
  if (selectedAds.has("Interstitial Ads")) families.add("Interstitial");
  return families;
}

function placementExampleFor(intake: GameIntake, adFamily: string) {
  const placements =
    adFamily === "Rewarded"
      ? splitValues(intake.rewardedAdPlacements)
      : adFamily === "Interstitial"
        ? splitValues(intake.interstitialAdPlacements)
        : [];
  const values = placements.flatMap((placement) => {
    if (adFamily === "Rewarded" && placement === "powerup") {
      return ["powerup", ...powerupSlugs(intake).map((name) => `powerup_${name}`)];
    }
    return [placement];
  });
  return [...new Set(values)].join(", ");
}

export function payloadsForEvent(snapshot: LibrarySnapshot, eventName: string, intake: GameIntake) {
  const seen = new Set<string>();
  const slugs = powerupSlugs(intake);
  const itemExamples = itemTransactionExamples(intake);
  const payloads = snapshot.payloads
    .filter((payload) => payload.eventName === eventName)
    .filter((payload) => {
      if (!slugs.length) return true;
      const field = canonicalFieldName(payload.canonicalFieldName || payload.fieldName);
      if (field === "powerup_used") return true;
      return !/^powerup_.+_used$/.test(field);
    })
    .filter((payload) => {
      const key = canonicalFieldName(payload.canonicalFieldName || payload.fieldName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((payload) => shouldIncludePayload(payload.canonicalFieldName || payload.fieldName, eventName, intake))
    .map((payload) => ({
      fieldName: payload.fieldName,
      canonicalFieldName: canonicalFieldName(payload.canonicalFieldName || payload.fieldName),
      type: payload.dataType,
      requiredness: payload.requiredness,
      description: payload.fieldDescription,
      example:
        itemExamples && payload.eventName === "Item_Transaction" && canonicalFieldName(payload.canonicalFieldName || payload.fieldName) === "item"
          ? itemExamples
          : payload.example,
      notes:
        itemExamples && payload.eventName === "Item_Transaction" && canonicalFieldName(payload.canonicalFieldName || payload.fieldName) === "item"
          ? [payload.note, "Example generated from selected item-producing mechanics and intake options."].filter(Boolean).join(" ")
          : payload.note,
    }));

  if (eventName === "Game_End") {
    for (const name of slugs) {
      const fieldName = `powerup_${name}_used`;
      if (seen.has(fieldName)) continue;
      seen.add(fieldName);
      payloads.push({
        fieldName,
        canonicalFieldName: fieldName,
        type: "Integer",
        requiredness: "Required/default (generated)",
        description: `<the number of ${name.replaceAll("_", " ")} power ups used in the game round>`,
        example: "2",
        notes: "Generated from Powerup Names intake.",
      });
    }
  }

  return payloads;
}

export function triggerFor(intake: GameIntake, eventName: string, fallback: string) {
  const title = intake.gameTitle || "the game";
  if (eventName === "Game_Start") {
    return `Fire when a player starts or resumes a playable round/session in ${title}.`;
  }
  if (eventName === "Game_End") {
    const lose = intake.loseConditions ? ` Lose conditions include: ${intake.loseConditions}.` : "";
    const win = intake.winConditions ? ` Win conditions include: ${intake.winConditions}.` : "";
    return `Fire when a playable round/session in ${title} ends.${win}${lose}`;
  }
  return fallback;
}

function reasonFor(eventName: string, pack: string, intake: GameIntake) {
  if (pack === PACKS.platformAds) {
    return "Ads are present, so platform ad events need consistent additional payloads; no manual ad lifecycle event specs are generated.";
  }
  if (eventName.includes("Transaction")) {
    return "The intake mentions economy, items, purchases, rewards, or ads, so transaction events are needed to track earn/spend outcomes.";
  }
  if (eventName.startsWith("Store")) {
    return "The intake mentions IAP/store behavior, so the store purchase funnel should be tracked.";
  }
  if (eventName.startsWith("Event_")) {
    return "The intake mentions live ops or events, so limited-time event lifecycle tracking is included.";
  }
  return `${intake.gameTitle || "This game"} has discrete gameplay rounds or attempts, so core gameplay start/end tracking is included.`;
}

export function generateSpecFromRules(intake: GameIntake, snapshot: LibrarySnapshot): GeneratedSpec {
  const selectedFeaturePacks = selectFeaturePacks(intake);
  const eventRows = snapshot.events
    .filter((event) => selectedFeaturePacks.includes(event.featurePack))
    .filter((event) => shouldIncludeEvent(event.eventName, intake));
  const generatedEvents: GeneratedEvent[] = eventRows.map((event) => ({
    eventName: event.eventName,
    category: event.category,
    featurePack: event.featurePack,
    trigger: triggerFor(intake, event.eventName, event.triggerDescription),
    argumentName: event.argumentType,
    argumentDescription: event.argumentDescription,
    argumentExamples: event.argumentExamples,
    payloadFields: payloadsForEvent(snapshot, event.eventName, intake),
    sourceReferences: event.sourceCoverage.split(",").map((item) => item.trim()).filter(Boolean),
    generationReason: reasonFor(event.eventName, event.featurePack, intake),
    status: "Draft",
  }));

  const platformAdPayloads = selectedFeaturePacks.includes(PACKS.platformAds)
    ? snapshot.platformAdPayloads
        .filter((payload) => adFamiliesForIntake(intake).has(payload.adFamily))
        .map((payload) => {
          const canonical = canonicalFieldName(payload.canonicalFieldName || payload.fieldName);
          return {
            platformEventName: payload.platformEventName,
            adFamily: payload.adFamily,
            payloadName: payload.fieldName,
            canonicalPayloadName: canonical,
            description: payload.fieldDescription,
            example: canonical === "placement" ? placementExampleFor(intake, payload.adFamily) : payload.example,
            requiredness: payload.requiredness,
          };
        })
    : [];

  const assumptions = [
    "Generated specs are drafts and should be reviewed by analytics, design, and engineering before implementation.",
    "Canonical field names are used for new specs: source, item, and dollar_value.",
  ];

  if (selectedFeaturePacks.includes(PACKS.platformAds)) {
    assumptions.push("Ad lifecycle events are platform-triggered; this spec only requires additional payload enrichment.");
  }

  return {
    id: `${Date.now()}`,
    generatedAt: new Date().toISOString(),
    intake,
    selectedFeaturePacks,
    generatedEvents,
    platformAdPayloads,
    assumptions,
  };
}

export async function enhanceSpecWithAi(spec: GeneratedSpec) {
  if (!process.env.OPENAI_API_KEY) {
    return { spec, aiUsed: false };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You refine draft game analytics specs. Return only valid JSON matching the input object. Do not rename events or canonical payload fields.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "Improve trigger wording and generationReason fields. Keep schema and event/payload names unchanged.",
            spec,
          }),
        },
      ],
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) {
    return { spec, aiUsed: false, aiError: await response.text() };
  }

  const data = await response.json();
  const text = data.output_text ?? data.output?.[0]?.content?.[0]?.text;
  if (!text) return { spec, aiUsed: false };

  try {
    return { spec: JSON.parse(text) as GeneratedSpec, aiUsed: true };
  } catch {
    return { spec, aiUsed: false };
  }
}
