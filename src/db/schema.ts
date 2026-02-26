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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
