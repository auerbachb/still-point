# Notifications

Still Point delivers remote push notifications via APNs. User-facing schedules and opt-in live in `notification_preferences`; the server dispatches on a cron and records sends in `notification_dispatches` for idempotency.

## Architecture

```mermaid
flowchart LR
  iOS[Settings UI] -->|GET/PATCH| PrefsAPI["/api/notifications/preferences"]
  PrefsAPI --> NP[(notification_preferences)]
  Cron["/api/cron/dispatch-notifications"] --> Scheduler[notification-scheduler]
  Scheduler --> NP
  Scheduler --> Ledger[(notification_dispatches)]
  Scheduler --> Send[notifications.ts]
  Send --> APNs[apns.ts]
  Send --> DT[(device_tokens)]
```

## Database

| Table | Purpose |
|-------|---------|
| `notification_preferences` | One row per user: master `push_enabled`, per-type flags, reminder time/frequency, quiet hours, IANA `tz` |
| `notification_dispatches` | Unique `(user_id, notification_type, window_key)` — claim before send so cron retries do not double-send |

Apply schema with `npm run db:migrate` (incremental SQL: `drizzle/notification_preferences_incremental.sql`).

## API

### `GET /api/notifications/preferences`

Returns defaults (created on first read) for the authenticated user.

### `PATCH /api/notifications/preferences`

Partial update. Supported fields:

- `pushEnabled`, `dailyReminderEnabled`, `missADayEnabled` (boolean)
- `dailyReminderTime`, `quietHoursStart`, `quietHoursEnd` (`HH:MM` 24h; quiet hours nullable)
- `dailyReminderFrequency`: `daily` | `every_other` | `weekly`
- `tz`: IANA timezone string

## Scheduler

- **Route:** `GET|POST /api/cron/dispatch-notifications`
- **Schedule:** every 5 minutes (`vercel.json` crons)
- **Auth:** `Authorization: Bearer $CRON_SECRET` (required in production)
- **Window:** matches users whose local reminder time falls within the last 5 minutes
- **Quiet hours:** skipped when local time is inside the configured range (overnight ranges supported)
- **Frequency:** `daily` = one send per local date; `every_other` = even day index; `weekly` = Mondays (local)

## Adding a notification type

1. **Preference flag** — Add a boolean column on `notification_preferences` (migration + schema + PATCH validation).
2. **Send helper** — Add `sendXNotification()` in `src/lib/notifications.ts` using `sendPushNotificationToUser` with a distinct `type` in the payload.
3. **Scheduler branch** — In `src/lib/notification-scheduler.ts`, select eligible users, compute a stable `window_key`, call `claimNotificationDispatch`, then the send helper.
4. **iOS** — Expose the flag in Settings (PATCH preferences) and handle the payload `type` when the user taps the notification.
5. **Tests** — Unit tests for preference validation, scheduler gating, and idempotent `claimNotificationDispatch`.

### Example: daily reminder (#346)

- Type: `daily_reminder`
- Window key: local `YYYY-MM-DD` (or `YYYY-Www` for weekly frequency)
- Helper: `sendDailyReminderNotification`
- Gated by: `push_enabled` && `daily_reminder_enabled`

## iOS

- Settings → **NOTIFICATIONS**: master push toggle (triggers system permission on first opt-in), daily reminder toggle, time picker, frequency picker, quiet hours.
- `PushNotificationCoordinator.requestAuthorizationAndRegister()` runs when the user enables push; login only re-registers the device token if permission was already granted.
- Device tokens: `POST|DELETE /api/device-token` (unchanged from #203).

## Security

- Never log raw APNs device tokens.
- Cron endpoint must not be callable without `CRON_SECRET` in production.

## Related issues

- #203 — APNs + `device_tokens`
- #346 — Daily reminder product behavior (builds on this foundation)
- #347 — Miss-a-day notifications
