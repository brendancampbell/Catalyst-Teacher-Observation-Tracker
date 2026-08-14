import { pgTable, serial, text, boolean, timestamp, pgEnum, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { people } from "./people";

export const notificationDisplayModeEnum = pgEnum("notification_display_mode", ["ONCE", "EVERY_LOGIN"]);

export const platformNotifications = pgTable("platform_notifications", {
  id:                    serial("id").primaryKey(),
  title:                 text("title").notNull(),
  body:                  text("body").notNull(),
  displayMode:           notificationDisplayModeEnum("display_mode").notNull().default("ONCE"),
  isActive:              boolean("is_active").notNull().default(false),
  createdByEmployeeId:   text("created_by_employee_id").references(() => people.employeeId, { onDelete: "set null" }),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationDismissals = pgTable(
  "notification_dismissals",
  {
    id:             serial("id").primaryKey(),
    notificationId: integer("notification_id").notNull().references(() => platformNotifications.id, { onDelete: "cascade" }),
    employeeId:     text("employee_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
    isPermanent:    boolean("is_permanent").notNull().default(true),
    dismissedAt:    timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notification_dismissals_notif_emp_idx").on(t.notificationId, t.employeeId)],
);

export type PlatformNotification = typeof platformNotifications.$inferSelect;
export type NotificationDismissal = typeof notificationDismissals.$inferSelect;
