import { db } from "@/db";
import {
  buddySessions,
  sessions,
  thoughts,
  users,
} from "@/db/schema";
import { shouldAdvanceDay, type SessionType, type Track } from "@/lib/constants";
import { and, eq, ne, sql } from "drizzle-orm";
import { isUniqueViolation } from "@/lib/dbErrors";

/**
 * Neon HTTP driver contract: each `db.execute()` / query is its own autocommit
 * transaction. Multi-statement serialization (e.g. `pg_advisory_xact_lock` in a
 * separate call) does not hold across statements. Atomicity here relies on single
 * SQL statements (CTEs) and DB constraints — not advisory locks in prior calls.
 */

type SessionInsertValues = typeof sessions.$inferInsert;
type ThoughtInsertRow = Pick<
  typeof thoughts.$inferInsert,
  "timeInSession" | "text"
>;

type UsernameUpdateResult =
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        username: string;
        isPublic: boolean;
        currentDay: number;
        aphorismsEnabled: boolean;
        attentionTrackingEnabled: boolean;
        ambientSoundEnabled: boolean;
        dualTrackEnabled: boolean;
        secondTrackDay: number;
        recoveryTargetDay: number | null;
        recoveryCurrentStep: number | null;
        recoveryTotalSteps: number | null;
      };
    }
  | { ok: false; reason: "taken" | "not_found" };

export async function atomicUpdateUsername(params: {
  userId: string;
  username: string;
  updates: Record<string, unknown>;
}): Promise<UsernameUpdateResult> {
  const { userId, username, updates } = params;

  try {
    const [updated] = await db
      .update(users)
      .set({ ...updates, username })
      .where(
        and(
          eq(users.id, userId),
          sql`not exists (
            select 1 from ${users} u
            where lower(u.username) = lower(${username})
              and u.id <> ${userId}
          )`,
        ),
      )
      // Keep in step with RETURN_FIELDS in src/app/api/settings/route.ts — the
      // iOS client adopts a settings response wholesale, so an omitted column
      // is nulled on the device (issue #664).
      .returning({
        id: users.id,
        email: users.email,
        username: users.username,
        isPublic: users.isPublic,
        currentDay: users.currentDay,
        aphorismsEnabled: users.aphorismsEnabled,
        attentionTrackingEnabled: users.attentionTrackingEnabled,
        ambientSoundEnabled: users.ambientSoundEnabled,
        dualTrackEnabled: users.dualTrackEnabled,
        secondTrackDay: users.secondTrackDay,
        recoveryTargetDay: users.recoveryTargetDay,
        recoveryCurrentStep: users.recoveryCurrentStep,
        recoveryTotalSteps: users.recoveryTotalSteps,
      });

    if (updated) {
      return { ok: true, user: updated };
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "taken" };
    }
    throw error;
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`lower(${users.username}) = lower(${username})`,
        ne(users.id, userId),
      ),
    )
    .limit(1);

  return { ok: false, reason: existing ? "taken" : "not_found" };
}

function mapThoughtRows(
  rows: Record<string, unknown>[],
): Array<{
  id: string;
  sessionId: string;
  dayNumber: number;
  timeInSession: number;
  text: string;
}> {
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    dayNumber: Number(row.day_number),
    timeInSession: Number(row.time_in_session),
    text: String(row.text),
  }));
}

export async function atomicReplaceCompletionNoteAndInsertThoughts(params: {
  userId: string;
  sessionId: string;
  dayNumber: number;
  completionNote: ThoughtInsertRow | null;
  rowsToInsert: ThoughtInsertRow[];
}): Promise<Array<{
  id: string;
  sessionId: string;
  dayNumber: number;
  timeInSession: number;
  text: string;
}>> {
  const { userId, sessionId, dayNumber, completionNote, rowsToInsert } = params;

  if (!completionNote && rowsToInsert.length === 0) {
    return [];
  }

  if (completionNote && rowsToInsert.length === 0) {
    await db
      .delete(thoughts)
      .where(
        and(
          eq(thoughts.sessionId, sessionId),
          eq(thoughts.userId, userId),
          eq(thoughts.timeInSession, -1),
        ),
      );
    return [];
  }

  const values = rowsToInsert.map((row) => ({
    userId,
    sessionId,
    dayNumber,
    timeInSession: row.timeInSession,
    text: row.text,
  }));

  if (completionNote) {
    const valueRows = values.map(
      (row) => sql`(${row.userId}::uuid, ${row.sessionId}::uuid, ${row.dayNumber}, ${row.timeInSession}, ${row.text})`,
    );
    const result = await db.execute(sql`
      with deleted as (
        delete from thoughts
        where session_id = ${sessionId}::uuid
          and user_id = ${userId}::uuid
          and time_in_session = -1
      ),
      inserted as (
        insert into thoughts (user_id, session_id, day_number, time_in_session, text)
        values ${sql.join(valueRows, sql`, `)}
        returning id, session_id, day_number, time_in_session, text
      )
      select id, session_id, day_number, time_in_session, text from inserted
    `);
    const mapped = mapThoughtRows(result.rows);
    if (mapped.length !== rowsToInsert.length) {
      throw new Error("THOUGHT_INSERT_MISMATCH");
    }
    return mapped;
  }

  const inserted = await db
    .insert(thoughts)
    .values(
      rowsToInsert.map((row) => ({
        userId,
        sessionId,
        dayNumber,
        timeInSession: row.timeInSession,
        text: row.text,
      })),
    )
    .returning({
      id: thoughts.id,
      sessionId: thoughts.sessionId,
      dayNumber: thoughts.dayNumber,
      timeInSession: thoughts.timeInSession,
      text: thoughts.text,
    });

  if (inserted.length !== rowsToInsert.length) {
    throw new Error("THOUGHT_INSERT_MISMATCH");
  }
  return inserted;
}

function mapBuddySessionRow(row: Record<string, unknown>): typeof buddySessions.$inferSelect {
  return {
    id: String(row.id),
    shareToken: String(row.share_token),
    hostUserId: String(row.host_user_id),
    state: String(row.state),
    durationSeconds: Number(row.duration_seconds),
    scheduledStartAt: row.scheduled_start_at
      ? new Date(String(row.scheduled_start_at))
      : null,
    startedAt: row.started_at ? new Date(String(row.started_at)) : null,
    dailyRoomName: row.daily_room_name ? String(row.daily_room_name) : null,
    dailyRoomUrl: row.daily_room_url ? String(row.daily_room_url) : null,
    revision: Number(row.revision),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function atomicCreateBuddySession(params: {
  shareToken: string;
  hostUserId: string;
  durationSeconds: number;
  scheduledStartAt: Date | null;
}): Promise<typeof buddySessions.$inferSelect | null> {
  const result = await db.execute(sql`
    with created_session as (
      insert into buddy_sessions (
        share_token, host_user_id, duration_seconds, scheduled_start_at, state
      )
      values (
        ${params.shareToken},
        ${params.hostUserId}::uuid,
        ${params.durationSeconds},
        ${params.scheduledStartAt},
        'waiting'
      )
      returning *
    ),
    host_participant as (
      insert into buddy_session_participants (
        buddy_session_id, user_id, is_host, ready
      )
      select id, ${params.hostUserId}::uuid, true, false
      from created_session
      returning buddy_session_id
    )
    select * from created_session
  `);

  const row = result.rows[0];
  return row ? mapBuddySessionRow(row) : null;
}

export async function atomicSyncBuddySessionDuration(
  sessionId: string,
): Promise<number | null> {
  const result = await db.execute(sql`
    with participant_lengths as (
      select greatest(
        60,
        min(least(600, 60 + (greatest(u.current_day, 1) - 1) * 10))
      ) as duration_seconds
      from buddy_session_participants p
      inner join users u on u.id = p.user_id
      where p.buddy_session_id = ${sessionId}::uuid
        and p.left_at is null
    ),
    updated as (
      update buddy_sessions bs
      set
        duration_seconds = participant_lengths.duration_seconds,
        updated_at = now()
      from participant_lengths
      where bs.id = ${sessionId}::uuid
        and bs.state in ('waiting', 'ready_check')
      returning bs.duration_seconds
    )
    select duration_seconds from updated
  `);

  const value = result.rows[0]?.duration_seconds;
  return typeof value === "number" ? value : null;
}

export async function atomicAcceptFriendRequest(params: {
  requestId: string;
  recipientUserId: string;
  user1Id: string;
  user2Id: string;
  reverseFromUserId: string;
  reverseToUserId: string;
}): Promise<{
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  updatedAt: Date;
} | null> {
  const result = await db.execute(sql`
    with accepted as (
      update friend_requests
      set status = 'accepted', updated_at = now()
      where id = ${params.requestId}::uuid
        and status = 'pending'
        and to_user_id = ${params.recipientUserId}::uuid
      returning id, from_user_id, to_user_id, status, updated_at
    ),
    friendship as (
      insert into friendships (user1_id, user2_id)
      select ${params.user1Id}::uuid, ${params.user2Id}::uuid
      from accepted
      on conflict do nothing
      returning user1_id
    ),
    cancelled as (
      update friend_requests fr
      set status = 'cancelled', updated_at = now()
      from accepted a
      where fr.id <> a.id
        and fr.from_user_id = ${params.reverseFromUserId}::uuid
        and fr.to_user_id = ${params.reverseToUserId}::uuid
        and fr.status = 'pending'
      returning fr.id
    )
    select id, from_user_id, to_user_id, status, updated_at from accepted
  `);

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    fromUserId: String(row.from_user_id),
    toUserId: String(row.to_user_id),
    status: String(row.status),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

export async function atomicDeleteUserAccount(params: {
  userId: string;
}): Promise<boolean> {
  const result = await db.execute(sql`
    with user_row as (
      select id, email
      from users
      where id = ${params.userId}::uuid
      for update
    ),
    logged as (
      insert into account_deletion_log (user_id, email_hash)
      select
        user_row.id,
        encode(digest(lower(trim(user_row.email)), 'sha256'), 'hex')
      from user_row
      returning id
    ),
    deleted as (
      delete from users u
      using user_row
      where u.id = user_row.id
      returning u.id
    )
    select id from deleted
  `);

  return result.rows.length > 0;
}

export async function atomicIssuePasswordResetToken(params: {
  userId: string;
  tokenHash: string;
  requestIpHash: string | null;
  expiresAt: Date;
  recentCutoff: Date;
  plainToken: string;
}): Promise<{
  token: string;
  newTokenId: string;
  previousTokenId: string | null;
} | null> {
  const result = await db.execute(sql`
    with recent as (
      select id
      from password_reset_tokens
      where user_id = ${params.userId}::uuid
        and used_at is null
        and created_at > ${params.recentCutoff}
      limit 1
    ),
    invalidated as (
      update password_reset_tokens
      set used_at = now()
      where user_id = ${params.userId}::uuid
        and used_at is null
        and not exists (select 1 from recent)
      returning id
    ),
    inserted as (
      insert into password_reset_tokens (
        user_id, token_hash, request_ip_hash, expires_at
      )
      select
        ${params.userId}::uuid,
        ${params.tokenHash},
        ${params.requestIpHash},
        ${params.expiresAt}
      where not exists (select 1 from recent)
      returning id
    )
    select
      (select id from inserted limit 1) as new_token_id,
      (select id from invalidated limit 1) as previous_token_id
  `);

  const row = result.rows[0];
  const newTokenId = row?.new_token_id ? String(row.new_token_id) : null;
  if (!newTokenId) return null;

  return {
    token: params.plainToken,
    newTokenId,
    previousTokenId: row?.previous_token_id ? String(row.previous_token_id) : null,
  };
}

export async function atomicRollbackPasswordResetToken(params: {
  userId: string;
  newTokenId: string;
  previousTokenId: string | null;
}): Promise<void> {
  if (params.previousTokenId) {
    await db.execute(sql`
      with invalidated as (
        update password_reset_tokens
        set used_at = now()
        where id = ${params.newTokenId}::uuid
          and user_id = ${params.userId}::uuid
          and used_at is null
        returning id
      ),
      restored as (
        update password_reset_tokens
        set used_at = null
        where id = ${params.previousTokenId}::uuid
          and user_id = ${params.userId}::uuid
          and not exists (
            select 1
            from password_reset_tokens prt
            where prt.user_id = ${params.userId}::uuid
              and prt.used_at is null
              and prt.id <> ${params.previousTokenId}::uuid
          )
        returning id
      )
      select 1
    `);
    return;
  }

  await db.execute(sql`
    update password_reset_tokens
    set used_at = now()
    where id = ${params.newTokenId}::uuid
      and user_id = ${params.userId}::uuid
      and used_at is null
  `);
}

export async function atomicConfirmPasswordReset(params: {
  userId: string;
  tokenHash: string;
  passwordHash: string;
  now: Date;
}): Promise<boolean> {
  const result = await db.execute(sql`
    with used as (
      update password_reset_tokens
      set used_at = ${params.now}
      where user_id = ${params.userId}::uuid
        and token_hash = ${params.tokenHash}
        and used_at is null
        and expires_at > ${params.now}
      returning user_id
    ),
    updated_user as (
      update users u
      set password_hash = ${params.passwordHash}, updated_at = ${params.now}
      from used
      where u.id = used.user_id
      returning u.id
    )
    select id from updated_user
  `);

  return result.rows.length > 0;
}

function mapSessionRow(row: Record<string, unknown>): typeof sessions.$inferSelect {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    clientSessionId: row.client_session_id ? String(row.client_session_id) : null,
    buddySessionId: row.buddy_session_id ? String(row.buddy_session_id) : null,
    dayNumber: Number(row.day_number),
    sessionType: String(row.session_type),
    track: String(row.track),
    duration: Number(row.duration),
    bonusSeconds: Number(row.bonus_seconds),
    completed: Boolean(row.completed),
    actualTime: row.actual_time == null ? null : Number(row.actual_time),
    clearPercent: Number(row.clear_percent),
    thoughtCount: Number(row.thought_count),
    breathCount: row.breath_count == null ? null : Number(row.breath_count),
    mindStateLog: row.mind_state_log as typeof sessions.$inferSelect["mindStateLog"],
    attentionLog: row.attention_log as typeof sessions.$inferSelect["attentionLog"],
    ambientSoundSummary: row.ambient_sound_summary as typeof sessions.$inferSelect["ambientSoundSummary"],
    sessionDate: String(row.session_date),
    focusRating: row.focus_rating == null ? null : Number(row.focus_rating),
    happinessRating: row.happiness_rating == null ? null : Number(row.happiness_rating),
    moodMatrix: row.mood_matrix as typeof sessions.$inferSelect["moodMatrix"],
    createdAt: new Date(String(row.created_at)),
  };
}

const activeRecoverySql = sql`(
  u.recovery_target_day is not null
  and u.recovery_current_step is not null
  and u.recovery_total_steps is not null
  and u.recovery_total_steps > 0
  and u.recovery_current_step >= 1
  and u.recovery_current_step <= u.recovery_total_steps
)`;

function progressionUpdateSql(shouldAdvance: boolean, track: Track) {
  return sql`
    current_day = case
      when not ${shouldAdvance} or ${track} <> 'primary' then u.current_day
      when ${activeRecoverySql}
        and u.recovery_current_step + 1 <= u.recovery_total_steps
      then u.current_day
      else u.current_day + 1
    end,
    recovery_target_day = case
      when not ${shouldAdvance} or ${track} <> 'primary' then u.recovery_target_day
      when ${activeRecoverySql}
        and u.recovery_current_step + 1 <= u.recovery_total_steps
      then u.recovery_target_day
      when ${activeRecoverySql}
        and u.recovery_current_step + 1 > u.recovery_total_steps
      then null
      else u.recovery_target_day
    end,
    recovery_current_step = case
      when not ${shouldAdvance} or ${track} <> 'primary' then u.recovery_current_step
      when ${activeRecoverySql}
        and u.recovery_current_step + 1 <= u.recovery_total_steps
      then u.recovery_current_step + 1
      else null
    end,
    recovery_total_steps = case
      when not ${shouldAdvance} or ${track} <> 'primary' then u.recovery_total_steps
      when ${activeRecoverySql}
        and u.recovery_current_step + 1 <= u.recovery_total_steps
      then u.recovery_total_steps
      else null
    end,
    second_track_day = case
      when not ${shouldAdvance} or ${track} <> 'second' or not u.dual_track_enabled
      then u.second_track_day
      else u.second_track_day + 1
    end,
    updated_at = now()
  `;
}

export async function atomicCreateSessionWithProgression(params: {
  userId: string;
  session: SessionInsertValues;
  sessionType: SessionType;
  completed: boolean;
  track: Track;
}): Promise<{ session: typeof sessions.$inferSelect; already: boolean }> {
  const shouldAdvance = shouldAdvanceDay(params.sessionType, params.completed);
  const { session, userId, track } = params;
  const clientSessionId = session.clientSessionId ?? null;

  if (clientSessionId) {
    const [existing] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.clientSessionId, clientSessionId),
        ),
      )
      .limit(1);
    if (existing) {
      return { session: existing, already: true };
    }
  }

  try {
    const result = await db.execute(sql`
      with locked as (
        select id from users where id = ${userId}::uuid for update
      ),
      inserted as (
        insert into sessions (
          user_id, client_session_id, buddy_session_id, day_number, session_type, track, duration,
          bonus_seconds, completed, actual_time, clear_percent, thought_count,
          breath_count, mind_state_log, attention_log, ambient_sound_summary, session_date
        )
        values (
          ${userId}::uuid,
          ${clientSessionId},
          ${session.buddySessionId ?? null},
          ${session.dayNumber},
          ${session.sessionType ?? "standard"},
          ${session.track ?? "primary"},
          ${session.duration},
          ${session.bonusSeconds ?? 0},
          ${session.completed},
          ${session.actualTime ?? session.duration},
          ${session.clearPercent},
          ${session.thoughtCount ?? 0},
          ${session.breathCount ?? null},
          ${JSON.stringify(session.mindStateLog ?? [])}::jsonb,
          ${session.attentionLog ? JSON.stringify(session.attentionLog) : null}::jsonb,
          ${session.ambientSoundSummary ? JSON.stringify(session.ambientSoundSummary) : null}::jsonb,
          ${session.sessionDate}
        )
        returning *
      ),
      progressed as (
        update users u
        set ${progressionUpdateSql(shouldAdvance, track)}
        from locked l
        where u.id = l.id
        returning u.id
      )
      select * from inserted
    `);

    const row = result.rows[0];
    if (!row) {
      throw new Error("SESSION_INSERT_FAILED");
    }
    return { session: mapSessionRow(row), already: false };
  } catch (error) {
    if (clientSessionId && isUniqueViolation(error)) {
      const [again] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            eq(sessions.clientSessionId, clientSessionId),
          ),
        )
        .limit(1);
      if (again) {
        return { session: again, already: true };
      }
    }
    throw error;
  }
}

export async function atomicRecordBuddyPersonalSession(params: {
  userId: string;
  buddySessionId: string;
  participantId: string;
  sessionDate: string;
  duration: number;
  actualTime: number;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: Array<{ time: number; state: string }>;
  participantCompletedAt: Date;
  now: Date;
  thoughtItems: ThoughtInsertRow[];
}): Promise<typeof sessions.$inferSelect | "USER_NOT_FOUND"> {
  const thoughtValues = params.thoughtItems.map(
    (item) => sql`(${item.timeInSession}::int4, ${item.text}::varchar)`,
  );
  const thoughtInsertCte = thoughtValues.length > 0
    ? sql`
    thought_rows as (
      insert into thoughts (user_id, session_id, day_number, time_in_session, text)
      select
        ${params.userId}::uuid,
        inserted.id,
        inserted.day_number,
        v.time_in_session,
        v.text
      from inserted
      cross join (values ${sql.join(thoughtValues, sql`, `)}) as v(time_in_session, text)
      returning id
    ),`
    : sql``;
  const thoughtCountSelect = thoughtValues.length > 0
    ? sql`(select count(*)::int from thought_rows)`
    : sql`0`;
  const thoughtCountValue = params.thoughtItems.length;

  const result = await db.execute(sql`
    with user_row as (
      select
        current_day,
        recovery_target_day,
        recovery_current_step,
        recovery_total_steps
      from users
      where id = ${params.userId}::uuid
    ),
    inserted as (
      insert into sessions (
        user_id, buddy_session_id, day_number, session_type, duration,
        completed, actual_time, clear_percent, thought_count, mind_state_log, session_date
      )
      select
        ${params.userId}::uuid,
        ${params.buddySessionId}::uuid,
        user_row.current_day,
        'standard',
        ${params.duration},
        true,
        ${params.actualTime},
        ${params.clearPercent},
        ${thoughtCountValue},
        ${JSON.stringify(params.mindStateLog)}::jsonb,
        ${params.sessionDate}
      from user_row
      returning *
    ),
    progressed as (
      update users u
      set ${progressionUpdateSql(true, "primary")}
      from user_row ur
      where u.id = ${params.userId}::uuid
        and exists (select 1 from user_row)
      returning u.id
    ),
    participant as (
      update buddy_session_participants p
      set
        participant_completed_at = ${params.participantCompletedAt},
        last_seen_at = ${params.now}
      where p.id = ${params.participantId}::uuid
        and exists (select 1 from user_row)
      returning p.id
    ),
    revision as (
      update buddy_sessions bs
      set revision = bs.revision + 1, updated_at = ${params.now}
      where bs.id = ${params.buddySessionId}::uuid
        and exists (select 1 from user_row)
      returning bs.id
    ),
    ${thoughtInsertCte}
    summary as (
      select
        inserted.*,
        ${thoughtCountSelect} as inserted_thought_count
      from inserted
      where exists (select 1 from participant)
        and exists (select 1 from revision)
    )
    select * from summary
  `);

  if (result.rows.length === 0) {
    return "USER_NOT_FOUND";
  }

  const row = result.rows[0]!;
  const insertedThoughtCount = Number(row.inserted_thought_count ?? 0);
  if (insertedThoughtCount !== params.thoughtItems.length) {
    throw new Error("THOUGHT_INSERT_MISMATCH");
  }

  return mapSessionRow(row);
}
