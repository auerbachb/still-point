import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { poolDb } from "../src/db/pool";
import * as schema from "../src/db/schema";
import { friendships, sessions, thoughts, users } from "../src/db/schema";

loadEnvConfig(process.cwd());

const REQUIRED_CONFIRMATION = "still-point-nonprod";
const CONFIRMATION_KEY = "SEED_CONFIRM";

type SeedUser = {
  email: string;
  username: string;
  currentDay: number;
  isPublic: boolean;
};

const baseSeedUsers: SeedUser[] = [
  { email: "ava+seed@stillpoint.local", username: "ava_seed", currentDay: 8, isPublic: true },
  { email: "leo+seed@stillpoint.local", username: "leo_seed", currentDay: 5, isPublic: true },
  { email: "maya+seed@stillpoint.local", username: "maya_seed", currentDay: 3, isPublic: false },
];

function withRunSuffix(value: string, suffix: string) {
  if (!suffix) {
    return value;
  }
  return `${value}_${suffix}`;
}

function withUniqueEmail(baseEmail: string, suffix: string) {
  if (!suffix) {
    return baseEmail;
  }
  const [localPart, domain = "stillpoint.local"] = baseEmail.split("@");
  return `${localPart}+${suffix}@${domain}`;
}

function buildSeedUsers(runId: string): SeedUser[] {
  return baseSeedUsers.map((user) => ({
    ...user,
    email: withUniqueEmail(user.email, runId),
    username: withRunSuffix(user.username, runId),
  }));
}

type AppDb = NeonDatabase<typeof schema>;

/** Rejects non-Neon or malformed URLs so the seed script cannot target arbitrary hosts by mistake. */
function assertNeonNonProdPostgresUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("POSTGRES_URL is not a valid URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("POSTGRES_URL must use postgres:// or postgresql://.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".neon.tech") && host !== "neon.tech") {
    throw new Error(
      "Refusing to seed: POSTGRES_URL hostname must be a Neon host (*.neon.tech). Point POSTGRES_URL at your non-production Neon branch.",
    );
  }
}

/** Idempotent non-production seed: replaces fixture users by email, then inserts sessions, thoughts, and friendship. */
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run seed script with NODE_ENV=production.");
  }

  if (process.env[CONFIRMATION_KEY] !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Refusing to seed without explicit confirmation. Re-run with ${CONFIRMATION_KEY}=${REQUIRED_CONFIRMATION}.`,
    );
  }

  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("POSTGRES_URL is required.");
  }

  assertNeonNonProdPostgresUrl(postgresUrl);

  const runId = (process.env.E2E_RUN_ID ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const seedUsers = buildSeedUsers(runId);
  const seedEmails = seedUsers.map((user) => user.email);

  await poolDb.transaction(async (tx: AppDb) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, seedEmails));

    if (existing.length > 0) {
      await tx.delete(users).where(inArray(users.id, existing.map((row) => row.id)));
    }

    const passwordHash = await bcrypt.hash("SeedPassword123!", 12);
    await tx.insert(users).values(
      seedUsers.map((user) => ({
        email: user.email,
        username: user.username,
        passwordHash,
        currentDay: user.currentDay,
        isPublic: user.isPublic,
      })),
    );

    const seededUsers = await tx
      .select({ id: users.id, email: users.email, day: users.currentDay })
      .from(users)
      .where(inArray(users.email, seedEmails));

    const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));
    const today = new Date().toISOString().slice(0, 10);

    const ava = usersByEmail.get(seedUsers[0]?.email ?? "");
    const leo = usersByEmail.get(seedUsers[1]?.email ?? "");
    const maya = usersByEmail.get(seedUsers[2]?.email ?? "");
    if (!ava || !leo || !maya) {
      throw new Error("Failed to fetch seeded users after insert.");
    }

    const sessionRows = await tx
      .insert(sessions)
      .values([
        {
          userId: ava.id,
          dayNumber: ava.day,
          sessionType: "standard",
          duration: 120,
          completed: true,
          actualTime: 120,
          clearPercent: 82,
          thoughtCount: 2,
          mindStateLog: [
            { time: 0, state: "clear" },
            { time: 38, state: "thinking" },
            { time: 61, state: "clear" },
          ],
          sessionDate: today,
        },
        {
          userId: leo.id,
          dayNumber: leo.day,
          sessionType: "standard",
          duration: 90,
          completed: true,
          actualTime: 90,
          clearPercent: 74,
          thoughtCount: 1,
          mindStateLog: [
            { time: 0, state: "clear" },
            { time: 45, state: "thinking" },
            { time: 59, state: "clear" },
          ],
          sessionDate: today,
        },
        {
          userId: maya.id,
          dayNumber: maya.day,
          sessionType: "standard",
          duration: 70,
          completed: false,
          actualTime: 42,
          clearPercent: 56,
          thoughtCount: 1,
          mindStateLog: [
            { time: 0, state: "clear" },
            { time: 24, state: "thinking" },
          ],
          sessionDate: today,
        },
      ])
      .returning({ id: sessions.id, userId: sessions.userId });

    const avaSession = sessionRows.find((row) => row.userId === ava.id);
    const leoSession = sessionRows.find((row) => row.userId === leo.id);
    const mayaSession = sessionRows.find((row) => row.userId === maya.id);
    if (!avaSession || !leoSession || !mayaSession) {
      throw new Error("Failed to create seeded sessions.");
    }

    await tx.insert(thoughts).values([
      {
        userId: ava.id,
        sessionId: avaSession.id,
        dayNumber: ava.day,
        timeInSession: 38,
        text: "Need to answer that message.",
      },
      {
        userId: ava.id,
        sessionId: avaSession.id,
        dayNumber: ava.day,
        timeInSession: -1,
        text: "Felt steadier after minute one.",
      },
      {
        userId: leo.id,
        sessionId: leoSession.id,
        dayNumber: leo.day,
        timeInSession: 45,
        text: "Planning tomorrow's meeting.",
      },
      {
        userId: maya.id,
        sessionId: mayaSession.id,
        dayNumber: maya.day,
        timeInSession: 24,
        text: "My playlist popped into my head.",
      },
    ]);

    const [user1Id, user2Id] = [ava.id, leo.id].sort();
    await tx.insert(friendships).values({ user1Id, user2Id }).onConflictDoNothing();

    // Keep output non-sensitive so this can be pasted into issue/PR comments.
    console.log(
      `Seed complete: users=${seededUsers.length}, sessions=${sessionRows.length}, thoughts=4, friendship=1, runId=${
        runId || "default"
      }`,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
