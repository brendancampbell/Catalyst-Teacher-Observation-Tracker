import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { people } from "./people";

export const aiQuotaGrantTypeEnum = pgEnum("ai_quota_grant_type", ["chat", "generation", "all"]);

export const aiQuotaGrants = pgTable("ai_quota_grants", {
  id:                  serial("id").primaryKey(),
  employeeId:          text("employee_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
  grantType:           aiQuotaGrantTypeEnum("grant_type").notNull(),
  extraRequests:       integer("extra_requests").notNull(),
  usedRequests:        integer("used_requests").notNull().default(0),
  expiresAt:           timestamp("expires_at", { withTimezone: true }).notNull(),
  grantedByEmployeeId: text("granted_by_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  note:                text("note"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /* Consulted on every rate-limited AI request that needs a grant lookup. */
  index("ai_quota_grants_employee_idx").on(t.employeeId),
]);

export type AiQuotaGrant = typeof aiQuotaGrants.$inferSelect;
