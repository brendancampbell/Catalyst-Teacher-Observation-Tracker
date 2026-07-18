import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const rateLimitStore = pgTable("rate_limit_store", {
  key:       text("key").primaryKey(),
  hits:      integer("hits").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type RateLimitStoreRow = typeof rateLimitStore.$inferSelect;
