import { z } from "zod";

const splitTextList = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const intakeSchema = z.object({
  gameTitle: z.string().min(1, "Game title is required"),
  genre: z.string(),
  coreLoop: z.string(),
  gameModes: z.string(),
  mechanics: z.string(),
  winConditions: z.string(),
  loseConditions: z.string(),
  economy: z.string(),
  itemsOrPowerups: z.string(),
  powerupNames: z.string(),
  iap: z.string(),
  ads: z.string(),
  rewardedAdPlacements: z.string(),
  interstitialAdPlacements: z.string(),
  liveOps: z.string(),
  notes: z.string(),
}).superRefine((value, ctx) => {
  const ads = new Set(splitTextList(value.ads));
  if (ads.has("Rewarded Ads") && !splitTextList(value.rewardedAdPlacements).length) {
    ctx.addIssue({
      code: "custom",
      path: ["rewardedAdPlacements"],
      message: "Select at least one rewarded ad placement.",
    });
  }
  if (ads.has("Interstitial Ads") && !splitTextList(value.interstitialAdPlacements).length) {
    ctx.addIssue({
      code: "custom",
      path: ["interstitialAdPlacements"],
      message: "Select at least one interstitial ad placement.",
    });
  }
});

export type GameIntake = z.infer<typeof intakeSchema>;

export const payloadFieldSchema = z.object({
  fieldName: z.string(),
  canonicalFieldName: z.string(),
  type: z.string(),
  requiredness: z.string(),
  description: z.string(),
  example: z.string(),
  notes: z.string(),
});

export type GeneratedPayloadField = z.infer<typeof payloadFieldSchema>;

export const generatedEventSchema = z.object({
  eventName: z.string(),
  category: z.string(),
  featurePack: z.string(),
  trigger: z.string(),
  argumentName: z.string(),
  argumentDescription: z.string(),
  argumentExamples: z.string(),
  payloadFields: z.array(payloadFieldSchema),
  sourceReferences: z.array(z.string()),
  generationReason: z.string(),
  status: z.string(),
});

export type GeneratedEvent = z.infer<typeof generatedEventSchema>;

export const generatedSpecSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  intake: intakeSchema,
  selectedFeaturePacks: z.array(z.string()),
  generatedEvents: z.array(generatedEventSchema),
  platformAdPayloads: z.array(
    z.object({
      platformEventName: z.string(),
      adFamily: z.string(),
      payloadName: z.string(),
      canonicalPayloadName: z.string(),
      description: z.string(),
      example: z.string(),
      requiredness: z.string(),
    }),
  ),
  assumptions: z.array(z.string()),
});

export type GeneratedSpec = z.infer<typeof generatedSpecSchema>;

export const savedSpecSummarySchema = z.object({
  id: z.string(),
  gameTitle: z.string(),
  genre: z.string(),
  status: z.string(),
  eventCount: z.number(),
  payloadCount: z.number(),
  generatedAt: z.string(),
  savedAt: z.string(),
  updatedAt: z.string(),
  ownerUserId: z.string().optional(),
  ownerEmail: z.string().optional(),
  ownerName: z.string().optional(),
  canEdit: z.boolean().optional(),
  canDelete: z.boolean().optional(),
});

export type SavedSpecSummary = z.infer<typeof savedSpecSummarySchema>;

export const userRoleSchema = z.enum(["admin", "editor", "viewer"]);

export type UserRole = z.infer<typeof userRoleSchema>;

export const appUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AppUser = z.infer<typeof appUserSchema>;

export const partnerDomainAccessSchema = z.object({
  domain: z.string(),
  enabled: z.boolean(),
  expiresAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  allowedApps: z.array(z.string()),
});

export type PartnerDomainAccess = z.infer<typeof partnerDomainAccessSchema>;

export type LibraryData = {
  metadata: Record<string, unknown>;
  event_catalog: Array<Record<string, unknown>>;
  payload_fields: Array<Record<string, unknown>>;
  field_dictionary: Array<Record<string, unknown>>;
  source_variants: Array<Record<string, unknown>>;
  scenario_library: Array<Record<string, unknown>>;
  platform_ad_payloads: Array<Record<string, unknown>>;
  generation_packs: Array<Record<string, unknown>>;
  governance_decisions: Array<Record<string, unknown>>;
  review_questions: Array<Record<string, unknown>>;
};

export type LibraryEvent = {
  eventName: string;
  featurePack: string;
  category: string;
  standardStatus: string;
  triggerDescription: string;
  argumentType: string;
  argumentDescription: string;
  argumentExamples: string;
  sourceCoverage: string;
  canonicalPayloadFields: string;
  generatorGuidance: string;
};

export type LibraryPayload = {
  eventName: string;
  featurePack: string;
  category: string;
  fieldName: string;
  canonicalFieldName: string;
  fieldDescription: string;
  example: string;
  dataType: string;
  requiredness: string;
  note: string;
  sourceLabel: string;
  sourceGame: string;
};

export type GenerationPack = {
  featurePack: string;
  applicableWhen: string;
  recommendedEventsOrPlatformEvents: string;
  launchPriority: string;
  notes: string;
};

export type PlatformAdPayload = {
  platformEventName: string;
  adFamily: string;
  description: string;
  fieldName: string;
  canonicalFieldName: string;
  fieldDescription: string;
  example: string;
  dataType: string;
  requiredness: string;
  featurePack: string;
  sourceLabel: string;
  sourceGame: string;
};

export type LibrarySnapshot = {
  events: LibraryEvent[];
  payloads: LibraryPayload[];
  generationPacks: GenerationPack[];
  governanceDecisions: Array<Record<string, string>>;
  platformAdPayloads: PlatformAdPayload[];
  scenarios: Array<Record<string, string>>;
};
