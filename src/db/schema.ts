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
  /** #338: flipped by Apple `email-disabled` / `email-enabled` relay notifications.
   *  False means mail to this address (private relay) will bounce. */
  emailDeliverable: boolean("email_deliverable").default(true).notNull(),
  /** #88: opt-in for a short meditation / digital-minimalism aphorism shown as
   *  pre-session inspiration on the Home view. Defaults off. */
  aphorismsEnabled: boolean("aphorisms_enabled").default(false).notNull(),
  /** #113: opt-in iOS ARKit gaze attention tracking during sessions. Defaults off
   *  so the camera is never requested without explicit user consent. */
  attentionTrackingEnabled: boolean("attention_tracking_enabled").default(false).notNull(),
  currentDay: integer("current_day").default(1).notNull(),
  /** #238: miss-a-day recovery ramp. Nullable trio — all three are set together when a
   *  2+ day gap is detected (`/api/auth/me`) and cleared together once the ramp finishes.
   *  `recoveryTargetDay` freezes the pre-miss `currentDay` (the level to ramp back to);
   *  `currentDay` is frozen mid-ramp but advances by one when the final recovery step
   *  completes (#559), preventing sparse sitters from livelocking below the cap. */
  recoveryTargetDay: integer("recovery_target_day"),
  recoveryCurrentStep: integer("recovery_current_step"),
  recoveryTotalSteps: integer("recovery_total_steps"),
  /** #240: dual-track fork. Once the primary track passes the 10-minute mark the
   *  user can opt into a second daily track that restarts at 1 minute and ramps
   *  +10s/day. `dualTrackEnabled` gates the second track; `secondTrackDay` is its
   *  independent day counter (starts at 1, capped at 10 min via `durationForDay`).
   *  Both are backward-compatible defaults so existing rows stay single-track. */
  dualTrackEnabled: boolean("dual_track_enabled").default(false).notNull(),
  secondTrackDay: integer("second_track_day").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  publicIdx: index("idx_users_public").on(table.isPublic),
  /** #8: Case-insensitive uniqueness for username; display case preserved in column. */
  usernameLowerUnique: uniqueIndex("users_username_lower_unique").on(sql`lower(${table.username})`),
  /** All three recovery columns are null together, or set together — never a partial state. */
  recoveryAllOrNone: check(
    "users_recovery_all_or_none",
    sql`(${table.recoveryTargetDay} is null) = (${table.recoveryCurrentStep} is null)
      and (${table.recoveryCurrentStep} is null) = (${table.recoveryTotalSteps} is null)`,
  ),
}));

/** Per-user notification opt-in and schedule (#345). One row per user. */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").default(false).notNull(),
  dailyReminderEnabled: boolean("daily_reminder_enabled").default(false).notNull(),
  missADayEnabled: boolean("miss_a_day_enabled").default(false).notNull(),
  /** #441: opt-in for the fixed 8 PM "log why you couldn't meditate" reminder. */
  failureReasonReminderEnabled: boolean("failure_reason_reminder_enabled").default(false).notNull(),
  friendRequestNotificationsEnabled: boolean("friend_request_notifications_enabled").default(true).notNull(),
  /** Opt-in (#431): suppress push display on this user's devices while a sit is in progress. */
  suppressDuringSession: boolean("suppress_during_session").default(false).notNull(),
  /** Local reminder time as HH:MM (24h). */
  dailyReminderTime: varchar("daily_reminder_time", { length: 5 }).default("09:00").notNull(),
  /** daily | every_other | weekly */
  dailyReminderFrequency: varchar("daily_reminder_frequency", { length: 20 }).default("daily").notNull(),
  quietHoursStart: varchar("quiet_hours_start", { length: 5 }),
  quietHoursEnd: varchar("quiet_hours_end", { length: 5 }),
  /** IANA timezone, e.g. America/New_York */
  tz: varchar("tz", { length: 64 }).default("UTC").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  frequencyCheck: check(
    "notification_preferences_frequency_allowed",
    sql`${table.dailyReminderFrequency} in ('daily', 'every_other', 'weekly')`,
  ),
  dispatchDueIdx: index("idx_notification_preferences_dispatch").on(
    table.pushEnabled,
    table.dailyReminderEnabled,
    table.missADayEnabled,
    table.failureReasonReminderEnabled,
    table.dailyReminderTime,
  ),
}));

/** Idempotent send ledger: one row per user/type/window (#345). */
export const notificationDispatches = pgTable("notification_dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  notificationType: varchar("notification_type", { length: 50 }).notNull(),
  /** e.g. 2026-05-29 (daily) or 2026-W22 (weekly) in the user's timezone */
  windowKey: varchar("window_key", { length: 32 }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dispatchUnique: uniqueIndex("notification_dispatches_user_type_window").on(
    table.userId,
    table.notificationType,
    table.windowKey,
  ),
}));

/** #441: user-logged reason for not meditating on a given local calendar day.
 *  At most one reason per user per day (revisable via upsert). */
export const failureReasons = pgTable("failure_reasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  /** Local calendar date the reason is about, `YYYY-MM-DD` (matches sessions.session_date). */
  reasonDate: date("reason_date").notNull(),
  text: varchar("text", { length: 1000 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userDateUnique: uniqueIndex("failure_reasons_user_date_unique").on(
    table.userId,
    table.reasonDate,
  ),
  /** A blank/whitespace-only row would make hasFailureReasonForDate() suppress the
   *  reminder for that day despite no real note. Reject text with no non-whitespace
   *  character (covers spaces, tabs, and newlines) at the DB layer. */
  textNotBlank: check(
    "failure_reasons_text_not_blank",
    sql`${table.text} ~ '[^[:space:]]'`,
  ),
}));

/** Browser Web Push subscriptions (#347). One row per Push API endpoint. */
export const webPushSubscriptions = pgTable("web_push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  endpoint: text("endpoint").notNull(),
  endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: varchar("user_agent", { length: 512 }),
  enabled: boolean("enabled").default(true).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  endpointHashUnique: uniqueIndex("web_push_subscriptions_endpoint_hash_unique").on(table.endpointHash),
  userEnabledIdx: index("idx_web_push_subscriptions_user_enabled").on(table.userId, table.enabled),
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

/** #338: Audit log for Sign in with Apple server-to-server notifications.
 *  One row per verified notification; duplicate deliveries sharing a `jti` are
 *  deduplicated (#532) rather than re-logged or re-processed.
 *  `user_id` has no FK so rows survive account deletion (same as account_deletion_log). */
export const appleNotificationLog = pgTable("apple_notification_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** account-delete(d) | consent-revoked | email-disabled | email-enabled; unknown types are logged too. */
  eventType: varchar("event_type", { length: 50 }).notNull(),
  /** Apple `sub` of the affected Apple ID. */
  subject: varchar("subject", { length: 255 }).notNull(),
  /** Apple-reported event time (`events.event_time`, ms epoch). */
  eventTime: timestamp("event_time", { withTimezone: true }),
  /** JWT `jti` claim — correlates retried deliveries of the same notification. */
  jti: varchar("jti", { length: 255 }),
  /** Affected app user when the Apple `sub` resolved to one. */
  userId: uuid("user_id"),
  /** Two-phase: rows start as "received", then are finalized with the handler
   *  outcome (account_deleted, apple_link_removed, noop_*, processing_failed, …). */
  actionTaken: varchar("action_taken", { length: 64 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  subjectIdx: index("idx_apple_notification_log_subject").on(table.subject),
  userIdx: index("idx_apple_notification_log_user").on(table.userId),
  jtiUnique: uniqueIndex("apple_notification_log_jti_unique")
    .on(table.jti)
    .where(sql`"jti" IS NOT NULL`),
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
  /** #147: Partial unique index — at most one `is_host` row per session. Joins always
   *  insert `is_host = false` and host-leave abandons rather than reassigning, so this
   *  guards the one-host invariant against a future bug or concurrent insert race. */
  oneHostPerSessionIdx: uniqueIndex("buddy_session_participants_one_host_per_session")
    .on(table.buddySessionId)
    .where(sql`${table.isHost}`),
  /** #383: backs `WHERE user_id = ?` calendar lookups and the on-delete-cascade
   *  fan-out from `users` on account deletion. The unique
   *  `(buddy_session_id, user_id)` index can't serve a standalone `user_id`
   *  predicate (wrong leading column). */
  userIdx: index("idx_buddy_session_participants_user").on(table.userId),
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
  /** #384: also serves standalone `buddy_session_id` predicates as a left-prefix,
   *  which is why the separate `idx_buddy_session_calendar_events_session` was
   *  dropped as redundant. */
  sessionUserUnique: uniqueIndex("buddy_session_calendar_events_session_user").on(
    table.buddySessionId,
    table.userId,
  ),
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
  /** #240: which daily progression this sit advanced — `primary` (original,
   *  10-minute-capped) or `second` (opt-in dual track). Defaults to `primary` so
   *  every pre-#240 row is attributed to the original track. */
  track: varchar("track", { length: 16 }).notNull().default("primary"),
  duration: integer("duration").notNull(),
  /** Seconds added via in-session +1/+5 extensions beyond `duration` (#90). */
  bonusSeconds: integer("bonus_seconds").notNull().default(0),
  completed: boolean("completed").notNull(),
  actualTime: integer("actual_time"),
  clearPercent: integer("clear_percent").notNull(),
  thoughtCount: integer("thought_count").default(0).notNull(),
  /** #374: taps-per-breath count for breath-counting sessions; null for other types. */
  breathCount: integer("breath_count"),
  mindStateLog: jsonb("mind_state_log").$type<Array<{ time: number; state: string }>>(),
  /** #113: ARKit gaze attention transitions ({ time, state: "attentive" | "away" }). */
  attentionLog: jsonb("attention_log").$type<Array<{ time: number; state: string }>>(),
  sessionDate: date("session_date").notNull(),
  /** #109: post-session self-report ratings (1-10), null until set via the
   *  by-session PATCH route from the CompletionScreen sliders. */
  focusRating: integer("focus_rating"),
  happinessRating: integer("happiness_rating"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_sessions_user").on(table.userId, table.dayNumber),
  buddyIdx: index("idx_sessions_buddy_session").on(table.buddySessionId),
  sessionTypeCheck: check(
    "sessions_session_type_allowed",
    sql`${table.sessionType} in ('standard', 'quick', 'breath')`,
  ),
  trackCheck: check(
    "sessions_track_allowed",
    sql`${table.track} in ('primary', 'second')`,
  ),
  /** #240: backs "did this user complete each track's standard sit today?" —
   *  the per-track completion badges HomeView shows for the dual-track view. */
  userTrackDateIdx: index("idx_sessions_user_track_date").on(
    table.userId,
    table.track,
    table.sessionDate,
  ),
  /** At most one personal session row per user per shared buddy sit. */
  userBuddyUnique: uniqueIndex("sessions_user_buddy_session_unique").on(
    table.userId,
    table.buddySessionId,
  ).where(sql`${table.buddySessionId} is not null`),
  focusRatingCheck: check(
    "sessions_focus_rating_range",
    sql`${table.focusRating} is null or (${table.focusRating} between 1 and 10)`,
  ),
  happinessRatingCheck: check(
    "sessions_happiness_rating_range",
    sql`${table.happinessRating} is null or (${table.happinessRating} between 1 and 10)`,
  ),
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
  webPushSubscriptions: many(webPushSubscriptions),
  notificationPreferences: one(notificationPreferences, {
    fields: [users.id],
    references: [notificationPreferences.userId],
  }),
  notificationDispatches: many(notificationDispatches),
  failureReasons: many(failureReasons),
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

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, { fields: [notificationPreferences.userId], references: [users.id] }),
}));

export const notificationDispatchesRelations = relations(notificationDispatches, ({ one }) => ({
  user: one(users, { fields: [notificationDispatches.userId], references: [users.id] }),
}));

export const deviceTokensRelations = relations(deviceTokens, ({ one }) => ({
  user: one(users, { fields: [deviceTokens.userId], references: [users.id] }),
}));

export const failureReasonsRelations = relations(failureReasons, ({ one }) => ({
  user: one(users, { fields: [failureReasons.userId], references: [users.id] }),
}));

export const webPushSubscriptionsRelations = relations(webPushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [webPushSubscriptions.userId], references: [users.id] }),
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
