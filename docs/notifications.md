# Push notifications (iOS MVP)

Scheduled meditation reminders use the server-side cron at `/api/cron/notifications` (every five minutes on Vercel). Delivery reuses APNs (`src/lib/notifications.ts`).

## Registering a new notification type

1. Add the type to `notification_dispatches.notification_type` (schema check + migration).
2. Implement `evaluate…Eligibility` + `send…Notification` under `src/lib/notifications/`.
3. Register the type in `runNotificationScheduler` in `src/lib/notifications/scheduler.ts`.
4. Respect **one push per user per local calendar day** via `notification_dispatches` (shared with daily reminder and miss-a-day).
5. Honor `notification_preferences`: `push_enabled`, quiet hours, per-type toggles, and `reminder_time` / `timezone`.

## Types shipped

| Type | Issue | Deep link | Precedence |
|------|-------|-----------|------------|
| `miss_a_day` | #247 | `stillpoint://session/quick` | Wins over daily reminder when yesterday was missed |
| `daily_reminder` | #346 | `stillpoint://session` | Default when miss-a-day does not apply |

## User preferences API

- `GET /api/notifications/preferences`
- `PATCH /api/notifications/preferences`

Fields: `pushEnabled`, `timezone`, `reminderTime`, `frequency`, `quietHoursStart`, `quietHoursEnd`, `dailyReminderEnabled`, `missADayEnabled`.

## Cron auth

Set `CRON_SECRET` in Vercel. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
