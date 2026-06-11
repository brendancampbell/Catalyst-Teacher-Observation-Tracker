/**
 * One-time bootstrap: create the first NETWORK_ADMIN in the people table.
 *
 * Runs on every startup but is a no-op once any NETWORK_ADMIN row exists.
 * Reads BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME from the environment.
 * If neither is set, silently skips (safe in dev without the vars configured).
 */
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export async function bootstrapAdmin(): Promise<void> {
  const email = process.env["BOOTSTRAP_ADMIN_EMAIL"]?.trim().toLowerCase();
  const name  = process.env["BOOTSTRAP_ADMIN_NAME"]?.trim() ?? "";

  if (!email) {
    return; // Not configured — skip silently
  }

  // Check if any NETWORK_ADMIN already exists
  const existing = await db.query.people.findFirst({
    where: eq(people.role, "NETWORK_ADMIN"),
  });

  if (existing) {
    logger.info("[bootstrap-admin] Admin already exists — skipping");
    return;
  }

  // Also check if this specific email already exists (any role)
  const byEmail = await db.query.people.findFirst({
    where: eq(people.email, email),
  });

  if (byEmail) {
    // Promote to NETWORK_ADMIN if they exist but aren't one yet
    await db
      .update(people)
      .set({ role: "NETWORK_ADMIN", isActive: true })
      .where(eq(people.email, email));
    logger.info({ email }, "[bootstrap-admin] Promoted existing person to NETWORK_ADMIN ✓");
    return;
  }

  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ");

  await db.insert(people).values({
    employeeId: randomUUID(),
    firstName:  firstName || email.split("@")[0] || "Admin",
    lastName:   lastName  || "",
    email,
    role:       "NETWORK_ADMIN",
    isActive:   true,
  });

  logger.info({ email, name }, "[bootstrap-admin] Created bootstrap NETWORK_ADMIN ✓");
}
