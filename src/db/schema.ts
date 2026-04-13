import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  jsonb,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, eq, sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  username: varchar("username", { length: 50 }).unique().notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isPublic: boolean("is_public").default(false).notNull(),
  currentDay: integer("current_day").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  publicIdx: index("idx_users_public").on(table.isPublic),
}));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  dayNumber: integer("day_number").notNull(),
  duration: integer("duration").notNull(),
  completed: boolean("completed").notNull(),
  actualTime: integer("actual_time"),
  clearPercent: integer("clear_percent").notNull(),
  thoughtCount: integer("thought_count").default(0).notNull(),
  mindStateLog: jsonb("mind_state_log").$type<Array<{ time: number; state: string }>>(),
  sessionDate: date("session_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_sessions_user").on(table.userId, table.dayNumber),
}));

export const thoughts = pgTable("thoughts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }).notNull(),
  dayNumber: integer("day_number").notNull(),
  timeInSession: integer("time_in_session").notNull(),
  text: varchar("text", { length: 1000 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_thoughts_user").on(table.userId, table.dayNumber),
}));

/** pending | accepted | rejected | cancelled */
export const friendRequests = pgTable("friend_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  noSelf: check("friend_requests_no_self", sql`${table.fromUserId} <> ${table.toUserId}`),
  statusCheck: check(
    "friend_requests_status_allowed",
    sql`${table.status} in ('pending', 'accepted', 'rejected', 'cancelled')`,
  ),
  pendingPairUnique: uniqueIndex("friend_requests_pending_from_to").on(table.fromUserId, table.toUserId).where(
    eq(table.status, "pending"),
  ),
  fromIdx: index("idx_friend_requests_from").on(table.fromUserId),
  toIdx: index("idx_friend_requests_to").on(table.toUserId),
}));

export const friendships = pgTable("friendships", {
  user1Id: uuid("user1_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  user2Id: uuid("user2_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.user1Id, table.user2Id] }),
  ordered: check("friendships_user_order", sql`${table.user1Id} < ${table.user2Id}`),
  user1Idx: index("idx_friendships_user1").on(table.user1Id),
  user2Idx: index("idx_friendships_user2").on(table.user2Id),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  thoughts: many(thoughts),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  thoughts: many(thoughts),
}));

export const thoughtsRelations = relations(thoughts, ({ one }) => ({
  user: one(users, { fields: [thoughts.userId], references: [users.id] }),
  session: one(sessions, { fields: [thoughts.sessionId], references: [sessions.id] }),
}));

export const friendRequestsRelations = relations(friendRequests, ({ one }) => ({
  fromUser: one(users, { fields: [friendRequests.fromUserId], references: [users.id] }),
  toUser: one(users, { fields: [friendRequests.toUserId], references: [users.id] }),
}));

export const friendshipsRelations = relations(friendships, ({ one }) => ({
  user1: one(users, { fields: [friendships.user1Id], references: [users.id] }),
  user2: one(users, { fields: [friendships.user2Id], references: [users.id] }),
}));
