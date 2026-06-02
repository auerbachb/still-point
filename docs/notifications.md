# Notifications

Still Point delivers remote push notifications via **APNs** (iOS) and **Web Push** (browsers). User-facing schedules and opt-in live in `notification_preferences`; the server dispatches on a cron and records sends in `notification_dispatches` for idempotency.

## Architecture

```mermaid
flowchart LR
  Clients[iOS + Web Settings] -->|GET/PATCH| PrefsAPI["/api/notifications/preferences"]
  Web[Web browser] -->|POST/DELETE| SubAPI["/api/notifications/push/subscription"]
  SubAPI --> WPS[(web_push_subscriptions)]
  PrefsAPI --> NP[(notification_preferences)]
  Cron["/api/cron/dispatch-notifications"] --> Scheduler[notification-scheduler]
  Scheduler --> NP
  Scheduler --> Ledger[(notification_dispatches)]
  Scheduler --> Send[notifications.ts]
  Send --> APNs[apns.ts]
  Send --> WebPush[web-push.ts]
  Send --> DT[(device_tokens)]
  WebPush --> WPS
```

## Database

| Table | Purpose |
|-------|---------|
| `notification_preferences` | One row per user: master `push_enabled`, per-type flags, reminder time/frequency, quiet hours, IANA `tz` |
| `notification_dispatches` | Unique `(user_id, notification_type, window_key)` — claim before send so cron retries do not double-send |
| `web_push_subscriptions` | Browser Push API endpoints + `p256dh` / `auth` keys per device (#347) |

Apply schema with `npm run db:migrate` (incremental SQL: `drizzle/notification_preferences_345_incremental.sql`, `drizzle/web_push_subscriptions_347_incremental.sql`).

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

## Web Push (#347)

### Environment

Generate keys locally (never commit the private key):

```bash
npx web-push generate-vapid-keys
```

Set in Vercel (and `.env.local` for local sends):

| Variable | Purpose |
|----------|---------|
| `WEB_PUSH_VAPID_PUBLIC_KEY` | VAPID public key (also exposed to the client as `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` via `next.config.ts`) |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Server-only; used by `src/lib/web-push.ts` |
| `WEB_PUSH_VAPID_SUBJECT` | `mailto:you@still-point.me` contact for push services |

### Service worker

- Static file: `public/sw.js` (scope `/`)
- Handles `push` → `showNotification`, `notificationclick` → focus or open `/app` (deep link from payload `url`)

### API

- `GET /api/notifications/push/subscription` — returns `{ publicKey }` when configured
- `POST /api/notifications/push/subscription` — body `{ subscription: { endpoint, keys } }` (authenticated)
- `DELETE /api/notifications/push/subscription` — body `{ endpoint }` (authenticated)

Web Settings (`WebNotificationSettings` in `SettingsView`) mirrors iOS: master push toggle, daily reminder, time, frequency. **Safari on iOS** requires the site as a home-screen PWA (iOS 16.4+); the UI explains this.

### Cross-channel behavior

If a user has both iOS and web push enabled, **both channels receive** the daily reminder (V1). Per-channel opt-out is via disabling push on that device/browser.

## iOS

- Settings → **NOTIFICATIONS**: master push toggle (triggers system permission on first opt-in), daily reminder toggle, time picker, frequency picker, quiet hours.
- `PushNotificationCoordinator.requestAuthorizationAndRegister()` runs when the user enables push; login only re-registers the device token if permission was already granted.
- Device tokens: `POST|DELETE /api/device-token` (unchanged from #203).

## Security

- Never log raw APNs device tokens or Web Push `auth` keys.
- Never commit `WEB_PUSH_VAPID_PRIVATE_KEY`.
- Cron endpoint must not be callable without `CRON_SECRET` in production.

## Related issues

- #203 — APNs + `device_tokens`
- #345 — Preferences + scheduler foundation
- #346 — Daily reminder product behavior
- #347 — Web Push parity
