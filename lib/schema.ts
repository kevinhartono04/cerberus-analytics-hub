import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const savedSpecs = pgTable("saved_specs", {
  id: text("id").primaryKey(),
  gameTitle: text("game_title").notNull(),
  genre: text("genre").notNull(),
  status: text("status").notNull(),
  eventCount: integer("event_count").notNull(),
  payloadCount: integer("payload_count").notNull(),
  generatedAt: text("generated_at").notNull(),
  savedAt: text("saved_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerUserId: text("owner_user_id"),
  ownerEmail: text("owner_email"),
  ownerName: text("owner_name"),
  payload: text("payload").notNull(),
});

export const appUsers = pgTable("app_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const techLaunchReadinessCache = pgTable("tech_launch_readiness_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});
