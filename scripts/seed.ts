import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
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

const seedUsers: SeedUser[] = [
  { email: "ava+seed@stillpoint.local", username: "ava_seed", currentDay: 8, isPublic: true },
  { email: "leo+seed@stillpoint.local", username: "leo_seed", currentDay: 5, isPublic: true },
  { email: "maya+seed@stillpoint.local", username: "maya_seed", currentDay: 3, isPublic: false },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run seed script with NODE_ENV=production.");
  }

  if (process.env[CONFIRMATION_KEY] !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Refusing to seed without explicit confirmation. Re-run with ${CONFIRMATION_KEY}=${REQUIRED_CONFIRMATION}.`,
    );
  }

  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required.");
  }

  const seedEmails = seedUsers.map((user) => user.email);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, seedEmails));

  if (existing.length > 0) {
    await db.delete(users).where(inArray(users.id, existing.map((row) => row.id)));
  }

  const passwordHash = await bcrypt.hash("SeedPassword123!", 12);
  await db.insert(users).values(
    seedUsers.map((user) => ({
      email: user.email,
      username: user.username,
      passwordHash,
      currentDay: user.currentDay,
      isPublic: user.isPublic,
    })),
  );

  const seededUsers = await db
    .select({ id: users.id, email: users.email, day: users.currentDay })
    .from(users)
    .where(inArray(users.email, seedEmails));

  const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));
  const today = new Date().toISOString().slice(0, 10);

  const ava = usersByEmail.get("ava+seed@stillpoint.local");
  const leo = usersByEmail.get("leo+seed@stillpoint.local");
  const maya = usersByEmail.get("maya+seed@stillpoint.local");
  if (!ava || !leo || !maya) {
    throw new Error("Failed to fetch seeded users after insert.");
  }

  const sessionRows = await db
    .insert(sessions)
    .values([
      {
        userId: ava.id,
        dayNumber: ava.day,
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

  await db.insert(thoughts).values([
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
  const existingFriendship = await db
    .select({ user1Id: friendships.user1Id })
    .from(friendships)
    .where(and(eq(friendships.user1Id, user1Id), eq(friendships.user2Id, user2Id)));

  if (existingFriendship.length === 0) {
    await db.insert(friendships).values({ user1Id, user2Id });
  }

  // Keep output non-sensitive so this can be pasted into issue/PR comments.
  console.log(
    `Seed complete: users=${seededUsers.length}, sessions=${sessionRows.length}, thoughts=4, friendship=1`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
