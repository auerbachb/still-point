# Notifications

Still Point delivers remote push notifications via **APNs** (iOS) and **Web Push** (browser). User-facing schedules and opt-in live in `notification_preferences`; the server dispatches scheduled types on a cron and records sends in `notification_dispatches` for idempotency.

## Architecture

```mermaid
flowchart LR
  iOS[Notifications screen] -->|GET/PATCH| PrefsAPI["/api/notifications/preferences"]
  Web[Notifications screen] -->|GET/PATCH| PrefsAPI
  PrefsAPI --> NP[(notification_preferences)]
  Cron["/api/cron/dispatch-notifications"] --> Scheduler[notification-scheduler]
  Scheduler --> NP
  Scheduler --> Ledger[(notification_dispatches)]
  Scheduler --> Send[notifications.ts]
  Send --> APNs[apns.ts]
  Send --> WebPush[web-push.ts]
  Send --> DT[(device_tokens)]
  Send --> WPS[(web_push_subscriptions)]
  Friends[POST /api/friends/requests] --> Send
```

## Database

| Table | Purpose |
|-------|---------|
| `notification_preferences` | One row per user: master `push_enabled`, per-type flags, reminder time/frequency, quiet hours, missed-sit call opt-in (`call_opt_in`, `call_phone_number`, `call_consent_at`, `call_window_start`, `call_window_stop`), IANA `tz`, `friend_request_notifications_enabled`, `suppress_during_session`, `session_active_until` (#709 server-side session signal, not user-editable) |
| `notification_dispatches` | Unique `(user_id, notification_type, window_key)` — claim before send so cron retries do not double-send |
| `call_attempts` | Outbound missed-sit Vapi call log (#599): phone, window key, status, optional `vapi_call_id` |
| `web_push_subscriptions` | Browser push endpoints (#347) |

Migrations: `drizzle/notification_preferences_345_incremental.sql`, `drizzle/web_push_subscriptions_347_incremental.sql`, `drizzle/notification_preferences_friend_request_359_incremental.sql`, `drizzle/notification_preferences_suppress_during_session_431_incremental.sql`, `drizzle/notification_preferences_dispatch_idx_531_incremental.sql`, `drizzle/notification_preferences_call_window_599_incremental.sql`, `drizzle/call_attempts_599_incremental.sql`, `drizzle/notification_preferences_session_active_709_incremental.sql`.

## API

### `GET /api/notifications/preferences`

Returns defaults (created on first read) for the authenticated user.

### `PATCH /api/notifications/preferences`

Partial update. Supported fields:

- `pushEnabled`, `dailyReminderEnabled`, `missADayEnabled`, `friendRequestNotificationsEnabled`, `suppressDuringSession`, `callOptIn` (boolean)
- `callPhoneNumber` (E.164, e.g. `+15551234567`), `callWindowStart`, `callWindowStop` (`HH:MM` 24h; window fields nullable)
- `dailyReminderTime`, `quietHoursStart`, `quietHoursEnd` (`HH:MM` 24h; quiet hours nullable)
- `dailyReminderFrequency`: `daily` | `every_other` | `weekly`
- `tz`: IANA timezone string

Quiet hours: `quietHoursStart` and `quietHoursEnd` must be updated together (or both set to `null`).

Call opt-in: `callOptIn: true` requires `callPhoneNumber` plus `callWindowStart` and `callWindowStop` (updated together). Consent timestamp `callConsentAt` is set on opt-in and cleared on opt-out. Call window fields must differ (`start !== stop`).

### `POST /api/notifications/session-state`

Authenticated. Body `{ "active": boolean }`. Reports whether a sit is running so the
server withholds this user's pushes for the duration (#709). `active: true` stores a
TTL-bounded `session_active_until`; `active: false` clears it. Ignored (stored as
`NULL`) for users who turned "Silence during sessions" off. Clients refresh on a 60s
heartbeat while the sit runs. Does not bump `updated_at` — a heartbeat is not a
preference edit.

### Web Push device registration

- `GET /api/notifications/push/subscription` — VAPID public key
- `POST|DELETE /api/notifications/push/subscription` — register/unregister browser subscription

### iOS device registration

`POST|DELETE /api/device-token` (unchanged from #203).

## Configuration

The dispatcher needs provider credentials **in every environment that runs the cron** (Production, and any Preview that dispatches). APNs requires all four of `APNS_BUNDLE_ID`, `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`; Web Push requires the `WEB_PUSH_VAPID_*` set. Missing any APNs var makes `getApnsConfig()` throw before a request reaches Apple.

Because a thrown provider-config error is caught per-token and never re-raised, a misconfigured environment fails **silently** — the cron still returns `200 {ok:true, sent:0}`. That left every scheduled iOS push undelivered for weeks (#621: `APNS_BUNDLE_ID` was simply unset in Production). Two guards now make that state visible:

- `getApnsConfigStatus()` (`src/lib/apns.ts`) is a non-throwing presence check. `sendPushNotificationToUser` preflights it and, when unconfigured, logs one actionable line naming the missing vars and skips the send — the device token is left enabled (a config error is not an APNs rejection).
- `/api/cron/dispatch-notifications` returns `apnsConfigured` (and `apnsMissing` when false) in its JSON, so the config state is visible at a glance instead of hidden behind a 200.

## Notification types

| Type | Issue | `notification_type` | Deep link (iOS) | Preference gate |
|------|-------|---------------------|-----------------|-----------------|
| Miss a day | #247 | `miss_a_day` | `stillpoint://session/quick` | `pushEnabled` + `missADayEnabled` |
| Daily practice reminder | #346 | `daily_reminder` | `stillpoint://home` | `pushEnabled` + `dailyReminderEnabled` + quiet hours + frequency |
| Friend request | #359 | `friend_request` | `stillpoint://home` | `pushEnabled` + `friendRequestNotificationsEnabled` |
| Failure-reason reminder | #441 | `failure_reason_reminder` | `stillpoint://log-reason?date=YYYY-MM-DD` | `pushEnabled` + `failureReasonReminderEnabled` |
| Missed-sit phone call | #599 | `missed_sit_call` | _(outbound Vapi call — no push)_ | `callOptIn` + phone + `[callWindowStart, callWindowStop]` |

Miss-a-day wins over daily reminder when both would fire in the same cron window (user missed yesterday and has not sat today).

### Missed-sit phone call (#599)

- Opt-in off by default; requires E.164 phone + local call window `[X, Y]`
- Hourly outbound Vapi calls from X through Y while the user has not completed a qualifying sit that local day
- Completing any qualifying sit cancels remaining calls for that day
- Idempotency `window_key` = `{localDate}T{hour}` (hour-granular, e.g. `2026-05-29T18`)
- Attempts logged in `call_attempts`; Vapi env vars (`VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`) required for live calls only

### Miss-a-day (#247)

- Fires in the user's daily reminder window when they have **not** completed a session today and **did not** complete one yesterday (local dates)
- Uses `window_key` = local `YYYY-MM-DD` and type `miss_a_day`
- Helper: `sendMissADayNotification` (APNs + Web Push)

### Daily reminder (#346)

- Window key: local `YYYY-MM-DD` (or `YYYY-Www` for weekly frequency)
- Helper: `sendDailyReminderNotification` (streak-aware copy + APNs/Web Push)
- Skipped when user already completed a session today, or a `miss_a_day` dispatch exists for the same local date

### Friend request (#359)

- Event-driven on `POST /api/friends/requests`
- Helper: `sendFriendRequestNotification` (APNs + Web Push)

### Failure-reason reminder (#441)

- Fixed **8 PM local** trigger, independent of `dailyReminderTime`
- Helper: `sendFailureReasonReminderNotification` (yesterday-first catch-up framing)
- Deep link: `/app/log-reason?date=…` (web) / `stillpoint://log-reason?date=…` (iOS)
- Idempotency `window_key` = local firing date (not the day being asked about)
- Skipped when user completed a session or logged a failure reason for the target day

## Suppress during session (#431, #709)

`suppress_during_session` (**default true** since #709) holds Still Point's own
notifications while a sit is in progress. It is an **opt-out**: the "Silence
during sessions" toggle stays on both Settings screens for users who want
reminders regardless.

Two layers, because neither is sufficient alone:

### Layer 1 — server withholds the send (#709)

Clients report session state to `POST /api/notifications/session-state`
(`{ active: boolean }`), which stores `notification_preferences.session_active_until`
= now + `SESSION_ACTIVE_TTL_MS` (3 min, `src/lib/notifications/session-active.ts`).
Clients refresh on a 60s heartbeat while the sit runs and clear the column when it
ends. A TTL rather than a boolean means a client that stops reporting (tab killed,
app suspended, network drop) self-heals instead of muting the user indefinitely.

- The write is gated on `suppress_during_session`, so an opted-out user is never
  tracked. `isSessionActive()` re-checks the preference on read too, so toggling it
  off takes effect immediately rather than at the end of the current sit.
- **Enforcement is at the choke point:** `fanOutToUser()` in `src/lib/notifications.ts`
  checks `isUserSessionActive()`, so every send helper — and any added later —
  inherits the hold. `dispatchDueNotifications()` additionally skips active-session
  users before claiming a dispatch row, keeping the ledger clean, and skips
  missed-sit **calls** for the same reason (a ringing phone mid-sit is the loudest
  interruption we own). The call path checks **twice**: once against the candidate
  scan, then again with a fresh `isUserSessionActive()` read immediately before
  dialing, releasing the claim if a sit started in between. A push that slips
  through still meets the #431 display layer; a ringing phone has no such fallback,
  so the re-read is the only thing that can stop it.
- **Reminders are held, not queued.** A cron reminder skipped mid-sit is re-evaluated
  on the next tick, which only re-sends if the 5-minute window is still open — a sit
  spanning the whole window drops that day's reminder. That is the intended trade:
  the user is doing the thing the reminder asks for, and `userCompletedSessionOnDate`
  suppresses it afterwards anyway. Missed-sit call slots are hourly, so a held call
  is dropped rather than deferred.
- Only this layer can cover a push that arrives while the iOS app is backgrounded
  (`willPresent` never runs) or during a service-worker cold start — the banner is
  already on screen by the time a client-side check could run.
- Reports are **serialized per client** (`reportSessionActiveState` on web, the
  report queue in `SessionNotificationSuppressionController` on iOS) so an in-flight
  heartbeat cannot land after the clear that ended the sit and re-suppress for a
  full TTL. iOS coalesces the queue **newest-wins** rather than chaining every
  report: `APIClient`'s request timeout is no shorter than the 60s heartbeat, so a
  chain on a slow network took one full request per stacked heartbeat to reach the
  ending `false`.
- **The queue is reset at the auth boundary.** Web sign-out is an in-page state
  reset rather than a reload, so a report queued by one account would otherwise
  drain under the next account's cookie and silence the wrong user; the web queue
  carries an epoch that logout bumps, and `clearSuppressPreference()` on iOS
  cancels anything queued or in flight.
- **Known bound — one signal per user, not per device.** With two clients in a
  session view simultaneously, whichever finishes first clears the hold and the
  still-sitting client re-establishes it on its next heartbeat (≤60s exposure). A
  client only sends `active: false` if it previously sent `active: true`, so an idle
  client never clears another's hold. Per-device leases were judged not worth the
  extra storage and client-identity plumbing for a one-person-one-sit product.

### Layer 2 — client display suppression (#431)

Kept as a second layer for anything already in flight when the sit starts.

- **Web:** `SessionView` relays the desired state (`prefOn && sessionActive`) to
  the service worker over a `BroadcastChannel`
  (`stillpoint-session-suppression`). `public/sw.js` keeps the latest flag
  (also persisted in Cache Storage so a push that cold-starts the worker still
  honors it) and skips `showNotification` while suppression is active. The pref
  is mirrored from the server row into `localStorage`
  (`src/lib/sessionSuppressionPrefs.ts`) so the in-progress page can read it
  without a network round-trip — the same pattern as the wake-lock pref (#317).
  - *Tradeoff:* the Push API mandates `userVisibleOnly`, so a browser may
    eventually show a generic background notice or trim the push budget if many
    pushes are dropped silently. Layer 1 keeps that rare — the push is usually
    never sent — and suppression is scoped to the short window of an active sit.
- **iOS:** `SessionNotificationSuppressionController` tracks the cached preference
  plus local/buddy session-active state (parity with `SessionIdleTimerController`),
  and owns the server heartbeat above. `PushNotificationCoordinator.willPresent`
  returns empty presentation options (no banner/sound) when a sit is in progress
  and the preference is on. The preference is cached in `UserDefaults` (defaulting
  to **on** for an unset key) so `willPresent` works before the Notifications
  screen is opened.

A paused sit still counts as "in session" on both platforms, so reminders stay
held until the sit truly completes or is abandoned.

**Not covered:** other apps' notifications. Only a system Focus mode can silence
those — an app cannot suppress notifications it did not send.

## Scheduler

- **Route:** `GET|POST /api/cron/dispatch-notifications`
- **Schedule:** every 5 minutes (`vercel.json` crons)
- **Auth:** `Authorization: Bearer $CRON_SECRET` (required in production)
- **Window:** matches users whose local reminder time falls within the last 5 minutes (including windows that cross local midnight)
- **Quiet hours:** skipped when local time is inside the configured range (overnight ranges supported)
- **Frequency:** `daily` = one send per local date; `every_other` = even day index; `weekly` = Mondays (local)
- **Dedup:** `claimNotificationDispatch` is the source of truth per `(user_id, notification_type, window_key)`
- **Missed-sit calls:** separate candidate query for `call_opt_in` users; cron JSON includes `callsInitiated` and `callCandidatesScanned`
- **DST spring-forward gap (#531):** reminders scheduled inside the skipped local hour on spring-forward night (e.g. 02:30 `America/New_York`) are not delivered — cron ticks land at 01:55 then 03:00, both outside the 5-minute window. This is a once-per-year-per-timezone edge case; no catch-up pass is implemented yet.

## Settings UI (#359)

- **iOS:** Settings → **Notifications** (`NavigationLink` → `NotificationsSettingsView`)
- **Web:** Settings → **Notifications** → `/app/settings/notifications`

Section order (parity): Push on this device → Daily practice reminder → Quiet hours → Missed-sit phone call → Miss a day → Friend activity → During sessions.

Master push off disables dependent controls in the UI and persists `pushEnabled: false` (and unsubscribes web push / disables iOS token as before). Other preference toggles are preserved while push is off.

## iOS tap handling

- `PushNotificationCoordinator` stores pending deep links until `RootView` wires handlers
- `stillpoint://home` → home
- `stillpoint://session` / `stillpoint://session/quick` → `AppViewModel.consumePendingSessionDeepLinkIfNeeded()`
- `stillpoint://log-reason?date=…` → native log-reason capture (`LogReasonView`)
- `stillpoint://friends` → friends surface (via notification deep-link handler)

## Adding a notification type

1. **Preference flag** — Add a boolean column on `notification_preferences` (migration + schema + PATCH validation).
2. **Send helper** — Add `sendXNotification()` in `src/lib/notifications.ts` (APNs + `sendWebPushToUser` where applicable).
3. **Scheduler branch** — In `src/lib/notification-scheduler.ts` for scheduled types, or event handler for instant types. Roll back the dispatch row if delivery fails.
4. **iOS + web** — Expose the flag on the Notifications screen; handle payload `type` / `deepLink` on tap.
5. **Tests** — Preference validation, scheduler gating, idempotent `claimNotificationDispatch`.

## Security

- Never log raw APNs device tokens or Web Push subscription keys.
- Cron endpoint must not be callable without `CRON_SECRET` in production.

## Related issues

- #203 — APNs + `device_tokens`
- #345 — Notification preferences foundation
- #346 — Daily reminder
- #347 — Web Push channel
- #247 — Miss-a-day notifications
- #359 — Unified Notifications settings screen
- #431 — Suppress notifications during a meditation session
- #709 — No notifications during a session (server-side hold + on by default)
- #599 — Missed-sit outbound Vapi phone calls
