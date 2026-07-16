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
| `notification_preferences` | One row per user: master `push_enabled`, per-type flags, reminder time/frequency, quiet hours, IANA `tz`, `friend_request_notifications_enabled`, `suppress_during_session` |
| `notification_dispatches` | Unique `(user_id, notification_type, window_key)` — claim before send so cron retries do not double-send |
| `web_push_subscriptions` | Browser push endpoints (#347) |

Migrations: `drizzle/notification_preferences_345_incremental.sql`, `drizzle/web_push_subscriptions_347_incremental.sql`, `drizzle/notification_preferences_friend_request_359_incremental.sql`, `drizzle/notification_preferences_suppress_during_session_431_incremental.sql`.

## API

### `GET /api/notifications/preferences`

Returns defaults (created on first read) for the authenticated user.

### `PATCH /api/notifications/preferences`

Partial update. Supported fields:

- `pushEnabled`, `dailyReminderEnabled`, `missADayEnabled`, `friendRequestNotificationsEnabled`, `suppressDuringSession` (boolean)
- `dailyReminderTime`, `quietHoursStart`, `quietHoursEnd` (`HH:MM` 24h; quiet hours nullable)
- `dailyReminderFrequency`: `daily` | `every_other` | `weekly`
- `tz`: IANA timezone string

Quiet hours: `quietHoursStart` and `quietHoursEnd` must be updated together (or both set to `null`).

### Web Push device registration

- `GET /api/notifications/push/subscription` — VAPID public key
- `POST|DELETE /api/notifications/push/subscription` — register/unregister browser subscription

### iOS device registration

`POST|DELETE /api/device-token` (unchanged from #203).

## Notification types

| Type | Issue | `notification_type` | Deep link (iOS) | Preference gate |
|------|-------|---------------------|-----------------|-----------------|
| Miss a day | #247 | `miss_a_day` | `stillpoint://session/quick` | `pushEnabled` + `missADayEnabled` |
| Daily practice reminder | #346 | `daily_reminder` | `stillpoint://home` | `pushEnabled` + `dailyReminderEnabled` + quiet hours + frequency |
| Friend request | #359 | `friend_request` | `stillpoint://home` | `pushEnabled` + `friendRequestNotificationsEnabled` |
| Failure-reason reminder | #441 | `failure_reason_reminder` | `stillpoint://log-reason?date=YYYY-MM-DD` | `pushEnabled` + `failureReasonReminderEnabled` |

Miss-a-day wins over daily reminder when both would fire in the same cron window (user missed yesterday and has not sat today).

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

## Suppress during session (#431)

Opt-in (`suppress_during_session`, default false) that holds push **display** on
the user's devices while a sit is in progress. The server still *sends* pushes
normally; suppression happens client-side per platform, and the pref is synced so
the choice carries across devices.

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
    pushes are dropped silently. Suppression is opt-in and scoped to the short
    window of an active sit, keeping that risk low.
- **iOS:** `SessionNotificationSuppressionController` tracks the cached opt-in
  plus local/buddy session-active state (parity with `SessionIdleTimerController`).
  `PushNotificationCoordinator.willPresent` returns empty presentation options
  (no banner/sound) when a sit is in progress and the opt-in is on. The opt-in is
  cached in `UserDefaults` so `willPresent` works before the Notifications screen
  is opened.

A paused sit still counts as "in session" on both platforms, so reminders stay
held until the sit truly completes or is abandoned.

## Scheduler

- **Route:** `GET|POST /api/cron/dispatch-notifications`
- **Schedule:** every 5 minutes (`vercel.json` crons)
- **Auth:** `Authorization: Bearer $CRON_SECRET` (required in production)
- **Window:** matches users whose local reminder time falls within the last 5 minutes (including windows that cross local midnight)
- **Quiet hours:** skipped when local time is inside the configured range (overnight ranges supported)
- **Frequency:** `daily` = one send per local date; `every_other` = even day index; `weekly` = Mondays (local)
- **Dedup:** `claimNotificationDispatch` is the source of truth per `(user_id, notification_type, window_key)`
- **DST spring-forward gap (#531):** reminders scheduled inside the skipped local hour on spring-forward night (e.g. 02:30 `America/New_York`) are not delivered — cron ticks land at 01:55 then 03:00, both outside the 5-minute window. This is a once-per-year-per-timezone edge case; no catch-up pass is implemented yet.

## Settings UI (#359)

- **iOS:** Settings → **Notifications** (`NavigationLink` → `NotificationsSettingsView`)
- **Web:** Settings → **Notifications** → `/app/settings/notifications`

Section order (parity): Push on this device → Daily practice reminder → Quiet hours → Miss a day → Friend activity → During sessions.

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
