import { describe, expect, it } from "vitest";
import { getLibrarySnapshot } from "@/lib/db";
import { generateSpecFromRules } from "@/lib/generator";
import {
  generateWithConfig,
  generationConfigSchema,
  matchesRule,
  seedGenerationConfig,
} from "@/lib/event-generation-config";
import type { GameIntake } from "@/lib/types";
const intake: GameIntake = {
  gameTitle: "Test",
  genre: "Puzzle",
  coreLoop: "levels",
  gameModes: "",
  mechanics: "Powerups, Revive, Limited moves",
  winConditions: "Clear board",
  loseConditions: "No moves",
  economy: "Currency, Item inventory",
  itemsOrPowerups: "",
  powerupNames: "Shuffle, Hammer",
  iap: "Store",
  ads: "Rewarded Ads, Interstitial Ads",
  rewardedAdPlacements: "powerup",
  interstitialAdPlacements: "game_end",
  liveOps: "season",
  notes: "",
};
const snapshot = getLibrarySnapshot();
describe("admin generation templates", () => {
  it("seeds a valid catalog preserving default output", () => {
    const config = seedGenerationConfig(snapshot);
    for (const input of [
      intake,
      {
        ...intake,
        mechanics: "",
        economy: "",
        powerupNames: "",
        ads: "",
        iap: "",
        liveOps: "",
      },
    ]) {
      const baseline = generateSpecFromRules(input, snapshot);
      const actual = generateWithConfig(input, snapshot, config, 1);
      expect(actual.generatedEvents.map((e) => e.eventName)).toEqual(
        baseline.generatedEvents.map((e) => e.eventName),
      );
      expect(actual.platformAdPayloads).toEqual(baseline.platformAdPayloads);
      for (const event of actual.generatedEvents) {
        const expected = baseline.generatedEvents.find(
          (e) => e.eventName === event.eventName,
        )!;
        expect(event.trigger).toEqual(expected.trigger);
        expect(
          event.payloadFields
            .map((f) => [f.canonicalFieldName, f.example])
            .sort(),
        ).toEqual(
          expected.payloadFields
            .map((f) => [f.canonicalFieldName, f.example])
            .sort(),
        );
      }
    }
  });
  it("propagates shared definitions, preserves explicit overrides, and supports renaming", () => {
    const config = seedGenerationConfig(snapshot);
    const shared = config.sharedFields.find(
      (s) =>
        config.events.filter((e) => e.sharedFieldIds.includes(s.id)).length > 1,
    )!;
    const targets = config.events.filter((e) =>
      e.sharedFieldIds.includes(shared.id),
    );
    targets.forEach((e) => {
      e.rule = { mode: "always", conditions: [] };
      e.fields = e.fields.filter(
        (f) => f.canonicalFieldName !== shared.field.canonicalFieldName,
      );
    });
    shared.field.rule = { mode: "always", conditions: [] };
    shared.field.example = "admin value";
    shared.field.useIntakeExample = false;
    targets[0].fields.push({ ...shared.field, example: "override" });
    const result = generateWithConfig(intake, snapshot, config, 7);
    expect(result.generationTemplateVersion).toBe(7);
    for (const [index, target] of targets.entries())
      expect(
        result.generatedEvents
          .find((e) => e.eventName === target.eventName)
          ?.payloadFields.find(
            (f) => f.canonicalFieldName === shared.field.canonicalFieldName,
          )?.example,
      ).toBe(index === 0 ? "override" : "admin value");
    const event = config.events.find(
      (e) => e.sourceEventName === "Game_Start",
    )!;
    const f =
      event.fields[0] ??
      config.sharedFields.find((s) => event.sharedFieldIds.includes(s.id))!
        .field;
    f.canonicalFieldName = "renamed_field";
    event.eventName = "Round_Start";
    event.trigger = "Begin {{gameTitle}}";
    event.useIntakeTrigger = false;
    const renamed = generateWithConfig(
      intake,
      snapshot,
      config,
      8,
    ).generatedEvents.find((e) => e.eventName === "Round_Start")!;
    expect(renamed.trigger).toBe("Begin Test");
    expect(
      renamed.payloadFields.some(
        (p) => p.canonicalFieldName === "renamed_field",
      ),
    ).toBe(true);
  });
  it("lets event and field rules replace hardcoded selection", () => {
    const config = seedGenerationConfig(snapshot);
    const event = config.events[0];
    event.rule = { mode: "never", conditions: [] };
    expect(
      generateWithConfig(intake, snapshot, config, 1).generatedEvents.some(
        (e) => e.eventName === event.eventName,
      ),
    ).toBe(false);
    expect(
      matchesRule(
        {
          mode: "all",
          conditions: [
            { field: "mechanics", operator: "contains", value: "revive" },
            { field: "ads", operator: "notEmpty", value: "" },
          ],
        },
        intake,
        false,
      ),
    ).toBe(true);
    expect(
      matchesRule(
        {
          mode: "any",
          conditions: [{ field: "genre", operator: "equals", value: "Racing" }],
        },
        intake,
        true,
      ),
    ).toBe(false);
  });
  it("does not resurrect removed static counters and lets admin rules include excluded fields", () => {
    const config = seedGenerationConfig(snapshot);
    const event = config.events.find((e) => e.sourceEventName === "Game_End")!;
    event.fields = event.fields.filter(
      (f) => !/^powerup_.+_used$/.test(f.canonicalFieldName),
    );
    event.sharedFieldIds = event.sharedFieldIds.filter(
      (id) =>
        !/^powerup_.+_used$/.test(
          config.sharedFields.find((s) => s.id === id)!.field
            .canonicalFieldName,
        ),
    );
    const result = generateWithConfig(
      { ...intake, powerupNames: "" },
      snapshot,
      config,
      1,
    );
    expect(
      result.generatedEvents
        .find((e) => e.eventName === "Game_End")!
        .payloadFields.some((f) =>
          /^powerup_.+_used$/.test(f.canonicalFieldName),
        ),
    ).toBe(false);
    event.fields.push({
      fieldName: "admin_field",
      canonicalFieldName: "admin_field",
      sourceFieldName: "",
      type: "String",
      requiredness: "Required",
      description: "Admin payload",
      example: "example",
      notes: "",
      useIntakeExample: false,
      rule: { mode: "always", conditions: [] },
    });
    expect(
      generateWithConfig(intake, snapshot, config, 1)
        .generatedEvents.find((e) => e.eventName === "Game_End")!
        .payloadFields.some((f) => f.canonicalFieldName === "admin_field"),
    ).toBe(true);
    event.fields.at(-1)!.rule.mode = "never";
    expect(
      generateWithConfig(intake, snapshot, config, 1)
        .generatedEvents.find((e) => e.eventName === "Game_End")!
        .payloadFields.some((f) => f.canonicalFieldName === "admin_field"),
    ).toBe(false);
  });

  it("rejects duplicate names, dangling references and empty conditions", () => {
    const config = seedGenerationConfig(snapshot);
    config.events[0].eventName = config.events[1].eventName;
    expect(generationConfigSchema.safeParse(config).success).toBe(false);
    const invalid = seedGenerationConfig(snapshot);
    invalid.events[0].sharedFieldIds.push("missing");
    expect(generationConfigSchema.safeParse(invalid).success).toBe(false);
    invalid.events[0].sharedFieldIds.pop();
    invalid.events[0].rule = { mode: "any", conditions: [] };
    expect(generationConfigSchema.safeParse(invalid).success).toBe(false);
  });
});
