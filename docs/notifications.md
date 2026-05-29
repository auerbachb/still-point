# Push notifications (iOS)

Still Point delivers iOS push notifications through Apple Push Notification service (APNs). Transport is implemented in `src/lib/apns.ts` and `src/lib/notifications.ts` (see PR #273).

This document covers **preferences**, the **scheduler**, and how to add new notification types.

## Architecture

1. Users opt in and configure timing in **Settings → Notifications** (iOS) backed by `notification_preferences`.
2. Vercel Cron calls `GET /api/cron/notifications` every five minutes (`vercel.json`).
3. The scheduler evaluates due notifications per user (local timezone, quiet hours, frequency, idempotency).
4. Eligible sends go through `sendPushNotificationToUser()` → APNs.

Cron requests must include `Authorization: Bearer <CRON_SECRET>`. Vercel sets `CRON_SECRET` on cron invocations; mirror it locally to test.

## Database: `notification_preferences`

| Column | Purpose |
|--------|---------|
| `enabled` | Master push opt-in |
| `daily_reminder_enabled` | Per-type toggle for daily reminder (#346) |
| `preferred_time` | Local `HH:MM` reminder time |
| `frequency` | `daily`, `every_other_day`, or `weekly` |
| `quiet_hours_start` / `quiet_hours_end` | Optional local quiet window |
| `timezone` | IANA timezone for all local-time checks |
| `last_daily_reminder_sent_at` | Idempotency cursor for daily reminder |
| `last_miss_a_day_sent_at` | De-dup with miss-a-day (#247) |

One row per user (`user_id` unique). Created on first PATCH from the app.

Migration: `drizzle/notification_preferences_incremental.sql` (applied via `npm run db:migrate`).

## API

### `GET /api/notifications/preferences`

Returns `{ preferences: { enabled, dailyReminderEnabled, preferredTime, frequency, quietHoursStart, quietHoursEnd, timezone } }`. Defaults when no row exists.

### `PATCH /api/notifications/preferences`

Partial update of the same fields. Requires session auth (`getCurrentUser()`).

## Daily reminder (#346)

Logic lives in `src/lib/notifications/daily-reminder.ts` and is invoked from `src/lib/notificationScheduler.ts`.

A user receives a daily reminder when:

- Master `enabled` and `dailyReminderEnabled` are true
- Local time is within the scheduler tick of `preferredTime` (5-minute window)
- Not in quiet hours
- Has **not** completed any session today (`session_date` in user TZ, `completed = true`)
- `last_daily_reminder_sent_at` is not today (user TZ)
- `last_miss_a_day_sent_at` is not today (de-dup with #247)
- Frequency rule passes (`every_other_day` / `weekly`)

Copy:

- Default: `Time for a moment of stillness. Tap to begin.`
- Streak > 3: `Day {N} of your streak — keep it going.`

Payload includes `type: "daily_reminder"` and `deepLink: "stillpoint://home"`. iOS opens the home screen from `PushNotificationCoordinator`.

## Adding a new notification type

1. Add a boolean column (and optional `last_*_sent_at`) to `notification_preferences` in `src/db/schema.ts`.
2. Add an idempotent SQL migration under `drizzle/`.
3. Expose the toggle in `NotificationSettingsView` and PATCH validation.
4. Add eligibility + payload builders under `src/lib/notifications/`.
5. Register dispatch in `runNotificationScheduler()` with transactional idempotency.
6. Handle tap / deep link in `PushNotificationCoordinator` (iOS).

Do **not** log device tokens or notification bodies containing user content (see `.claude/rules/safety.md`).

## Local testing

```bash
export CRON_SECRET=local-dev-secret
curl -s -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/notifications
```

Real-device verification is required before merge; the Simulator is unreliable for push delivery.
