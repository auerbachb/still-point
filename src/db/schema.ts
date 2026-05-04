import {
  pgTable,
  uuid,
  varchar,
  text,
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
import { relations, sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored lowercased by the signup route, so the column-level unique constraint
   *  is effectively case-insensitive and its btree backs login/password-reset
   *  `eq(users.email, ...)` lookups. */
  email: varchar("email", { length: 255 }).unique().notNull(),
  username: varchar("username", { length: 50 }).notNull(),
  /** Nullable: OAuth-only accounts (#136) never have a password. */
  passwordHash: varchar("password_hash", { length: 255 }),
  isPublic: boolean("is_public").default(false).notNull(),
  currentDay: integer("current_day").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  publicIdx: index("idx_users_public").on(table.isPublic),
  /** #8: Case-insensitive uniqueness for username; display case preserved in column. */
  usernameLowerUnique: uniqueIndex("users_username_lower_unique").on(sql`lower(${table.username})`),
}));

export const deviceTokens = pgTable("device_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  token: text("token").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  apnsEnvironment: varchar("apns_environment", { length: 20 }).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  lastRegisteredAt: timestamp("last_registered_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userEnabledIdx: index("idx_device_tokens_user_enabled").on(table.userId, table.enabled),
  tokenEnvUnique: uniqueIndex("device_tokens_token_hash_env_unique").on(
    table.tokenHash,
    table.apnsEnvironment,
  ),
  platformCheck: check("device_tokens_platform_allowed", sql`${table.platform} in ('ios')`),
  apnsEnvironmentCheck: check(
    "device_tokens_apns_environment_allowed",
    sql`${table.apnsEnvironment} in ('development', 'production')`,
  ),
}));

export const accountDeletionLog = pgTable("account_deletion_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  emailHash: varchar("email_hash", { length: 64 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailHashIdx: index("idx_account_deletion_log_email_hash").on(table.emailHash),
  userIdx: index("idx_account_deletion_log_user").on(table.userId),
}));

/** OAuth provider identities linked to a user (#136).
 *  One row per (provider, providerAccountId); a single user may have
 *  multiple rows (one per provider). Email-match account linking is
 *  performed in `src/lib/oauth-user-resolution.ts` (Auth.js + native Apple). */
export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  providerAccountUnique: uniqueIndex("oauth_accounts_provider_account_unique").on(
    table.provider,
    table.providerAccountId,
  ),
  userIdx: index("idx_oauth_accounts_user").on(table.userId),
  providerCheck: check(
    "oauth_accounts_provider_allowed",
    sql`${table.provider} in ('google', 'apple', 'facebook', 'microsoft-entra-id')`,
  ),
}));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  requestIpHash: varchar("request_ip_hash", { length: 64 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_password_reset_tokens_user").on(table.userId),
  tokenHashIdx: uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
  /** Partial unique index: only rows with `used_at IS NULL` participate, so one active token per user while allowing many historical used rows. */
  activeUserIdx: uniqueIndex("password_reset_tokens_active_user_unique").on(table.userId).where(
    sql`${table.usedAt} is null`,
  ),
}));

/** waiting | ready_check | active | completed | abandoned */
export const buddySessions = pgTable("buddy_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shareToken: varchar("share_token", { length: 48 }).unique().notNull(),
  hostUserId: uuid("host_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  state: varchar("state", { length: 20 }).notNull().default("waiting"),
  durationSeconds: integer("duration_seconds").notNull(),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  /** Daily.co room name (for DELETE); set when the shared sit starts (#106). */
  dailyRoomName: varchar("daily_room_name", { length: 128 }),
  /** Daily.co meeting URL for participants while `state === 'active'`. */
  dailyRoomUrl: text("daily_room_url"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  stateCheck: check(
    "buddy_sessions_state_allowed",
    sql`${table.state} in ('waiting', 'ready_check', 'active', 'completed', 'abandoned')`,
  ),
  hostIdx: index("idx_buddy_sessions_host").on(table.hostUserId),
}));

export const buddySessionParticipants = pgTable("buddy_session_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  buddySessionId: uuid("buddy_session_id").references(() => buddySessions.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  isHost: boolean("is_host").notNull().default(false),
  ready: boolean("ready").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  /** #119: participant finished their sit; journaling attaches here. */
  participantCompletedAt: timestamp("participant_completed_at", { withTimezone: true }),
}, (table) => ({
  sessionUserUnique: uniqueIndex("buddy_session_participants_session_user").on(
    table.buddySessionId,
    table.userId,
  ),
}));

/** Google Calendar OAuth connection per app user (#204). Tokens are encrypted server-side. */
export const googleOAuthTokens = pgTable("google_oauth_tokens", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  googleSub: varchar("google_sub", { length: 255 }),
  googleEmail: varchar("google_email", { length: 255 }),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  scope: text("scope").notNull(),
  tokenType: varchar("token_type", { length: 32 }).notNull().default("Bearer"),
  expiryDate: timestamp("expiry_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailIdx: index("idx_google_oauth_tokens_email").on(table.googleEmail),
}));

/** Per-user Google Calendar event sync state for scheduled buddy sessions (#204). */
export const buddySessionCalendarEvents = pgTable("buddy_session_calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  buddySessionId: uuid("buddy_session_id").references(() => buddySessions.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  googleEventId: text("google_event_id"),
  htmlLink: text("html_link"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionUserUnique: uniqueIndex("buddy_session_calendar_events_session_user").on(
    table.buddySessionId,
    table.userId,
  ),
  sessionIdx: index("idx_buddy_session_calendar_events_session").on(table.buddySessionId),
  userIdx: index("idx_buddy_session_calendar_events_user").on(table.userId),
  statusCheck: check(
    "buddy_session_calendar_events_status_allowed",
    sql`${table.status} in ('created', 'failed', 'deleted')`,
  ),
}));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  /** #119: provenance when this row was created from a completed buddy sit (personal copy per user). */
  buddySessionId: uuid("buddy_session_id").references(() => buddySessions.id, { onDelete: "set null" }),
  dayNumber: integer("day_number").notNull(),
  sessionType: varchar("session_type", { length: 20 }).notNull().default("standard"),
  duration: integer("duration").notNull(),
  /** Seconds added via in-session +1/+5 extensions beyond `duration` (#90). */
  bonusSeconds: integer("bonus_seconds").notNull().default(0),
  completed: boolean("completed").notNull(),
  actualTime: integer("actual_time"),
  clearPercent: integer("clear_percent").notNull(),
  thoughtCount: integer("thought_count").default(0).notNull(),
  mindStateLog: jsonb("mind_state_log").$type<Array<{ time: number; state: string }>>(),
  sessionDate: date("session_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_sessions_user").on(table.userId, table.dayNumber),
  buddyIdx: index("idx_sessions_buddy_session").on(table.buddySessionId),
  sessionTypeCheck: check(
    "sessions_session_type_allowed",
    sql`${table.sessionType} in ('standard', 'quick')`,
  ),
  /** At most one personal session row per user per shared buddy sit. */
  userBuddyUnique: uniqueIndex("sessions_user_buddy_session_unique").on(
    table.userId,
    table.buddySessionId,
  ).where(sql`${table.buddySessionId} is not null`),
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
  /** At most one pending request per unordered pair (blocks A→B and B→A simultaneously). */
  pendingUsersPairUnique: uniqueIndex("friend_requests_pending_user_pair").on(
    sql`least(${table.fromUserId}, ${table.toUserId})`,
    sql`greatest(${table.fromUserId}, ${table.toUserId})`,
  ).where(sql`${table.status} = 'pending'`),
  fromIdx: index("idx_friend_requests_from").on(table.fromUserId),
  toIdx: index("idx_friend_requests_to").on(table.toUserId),
  /** #146: pending inbox/outbox list — match API filters + created_at for ordering. */
  toPendingCreatedIdx: index("idx_friend_requests_to_pending_created")
    .on(table.toUserId, table.createdAt.desc())
    .where(sql`${table.status} = 'pending'`),
  fromPendingCreatedIdx: index("idx_friend_requests_from_pending_created")
    .on(table.fromUserId, table.createdAt.desc())
    .where(sql`${table.status} = 'pending'`),
}));

export const friendships = pgTable("friendships", {
  user1Id: uuid("user1_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  user2Id: uuid("user2_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.user1Id, table.user2Id] }),
  ordered: check("friendships_user_order", sql`${table.user1Id} < ${table.user2Id}`),
  user2Idx: index("idx_friendships_user2").on(table.user2Id),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  sessions: many(sessions),
  thoughts: many(thoughts),
  passwordResetTokens: many(passwordResetTokens),
  deviceTokens: many(deviceTokens),
  oauthAccounts: many(oauthAccounts),
  googleOAuthToken: one(googleOAuthTokens, {
    fields: [users.id],
    references: [googleOAuthTokens.userId],
  }),
  buddyCalendarEvents: many(buddySessionCalendarEvents),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const deviceTokensRelations = relations(deviceTokens, ({ one }) => ({
  user: one(users, { fields: [deviceTokens.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const buddySessionsRelations = relations(buddySessions, ({ one, many }) => ({
  host: one(users, { fields: [buddySessions.hostUserId], references: [users.id] }),
  participants: many(buddySessionParticipants),
  personalSessions: many(sessions),
  calendarEvents: many(buddySessionCalendarEvents),
}));

export const buddySessionParticipantsRelations = relations(buddySessionParticipants, ({ one }) => ({
  session: one(buddySessions, {
    fields: [buddySessionParticipants.buddySessionId],
    references: [buddySessions.id],
  }),
  user: one(users, { fields: [buddySessionParticipants.userId], references: [users.id] }),
}));

export const googleOAuthTokensRelations = relations(googleOAuthTokens, ({ one }) => ({
  user: one(users, { fields: [googleOAuthTokens.userId], references: [users.id] }),
}));

export const buddySessionCalendarEventsRelations = relations(
  buddySessionCalendarEvents,
  ({ one }) => ({
    session: one(buddySessions, {
      fields: [buddySessionCalendarEvents.buddySessionId],
      references: [buddySessions.id],
    }),
    user: one(users, { fields: [buddySessionCalendarEvents.userId], references: [users.id] }),
  }),
);

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  buddySession: one(buddySessions, {
    fields: [sessions.buddySessionId],
    references: [buddySessions.id],
  }),
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
