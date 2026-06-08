# Unified Notifications settings (iOS + Web parity)

**Suggested title:** Settings → Notifications: single screen, all notification types  
**Suggested labels:** `enhancement`, `notifications`, `ios`, `web`  
**Blocks / related:** #345 (foundation), #346 (daily reminder), #347 (web push), #247 (miss-a-day, if tracked separately)

## Problem

Product expectation: **one Notifications screen**, reachable from **Settings**, that is **the same on iOS and web** and lets users **control every notification type** the app sends (opt-in, schedule where applicable).

Today that is **not** true:

| Area | iOS (`SettingsView` → NOTIFICATIONS section) | Web (`SettingsView` → `WebNotificationSettings`) |
|------|-----------------------------------------------|--------------------------------------------------|
| Entry | Section inside Settings scroll | Section inside Settings scroll |
| Master push opt-in | Yes | Yes (+ Web Push subscription) |
| Daily reminder + time + frequency | Yes | Yes |
| Quiet hours | Yes | **No** |
| Miss-a-day | **No** (API field only) | **No** |
| Friend request pushes | **No** (always sent; no preference) | **No** (iOS/APNs only today) |
| Timezone display/edit | Implicit (device) | Read-only display on opt-in |

Backend `notification_preferences` already has `missADayEnabled`, but **no scheduler send path** exists for `miss_a_day` yet (only dedup against existing dispatches). Friend requests call `sendFriendRequestNotification` with **no preference gate** and **no web push**.

## Notification inventory (codebase today)

| Type | `notification_type` | Trigger | Preference gate | Scheduled? | iOS UI | Web UI | Web Push |
|------|---------------------|---------|-----------------|------------|--------|--------|----------|
| Daily practice reminder | `daily_reminder` | Cron `/api/cron/dispatch-notifications` | `pushEnabled` + `dailyReminderEnabled` + quiet hours + frequency + tz | Yes (user time) | Partial | Partial | Yes (#347) |
| Miss a day | `miss_a_day` | **Not implemented** (flag + dedup only) | `missADayEnabled` (unused by sender) | TBD (#247) | No | No | No |
| Friend request | `friend_request` | `POST /api/friends/requests` | **None** | No (event) | No | No | No |

**Shared API:** `GET|PATCH /api/notifications/preferences`  
**iOS device registration:** `POST|DELETE /api/device-token`  
**Web device registration:** `POST|DELETE /api/notifications/push/subscription`

## Target UX

### Navigation

- **Settings** includes a row/menu item: **Notifications** (same label on both platforms).
- Tapping opens a **dedicated Notifications screen** (not buried mid-scroll), so iOS and web share the same information architecture.
- Web route suggestion: `/app/settings/notifications` (or modal/sheet from Settings — pick one pattern and mirror on iOS as `NavigationLink`).

### Screen layout (parity contract)

Use the **same section order and copy** on iOS and web (allow platform-native controls: `Toggle` vs button, `DatePicker` vs `<input type="time">`).

1. **Push on this device**
   - Master toggle: enable/disable push for this device/browser.
   - iOS: system permission + APNs token registration (existing `NotificationPreferencesViewModel` / `PushNotificationCoordinator`).
   - Web: permission + service worker + subscription (existing `WebNotificationSettings` flow).
   - Web-only helper text: Safari iOS home-screen PWA requirement.

2. **Daily practice reminder** (only when master push is on)
   - Toggle: on/off → `dailyReminderEnabled`
   - Time → `dailyReminderTime` (`HH:MM`, 24h)
   - Frequency → `dailyReminderFrequency` (`daily` | `every_other` | `weekly`)
   - Timezone → `tz` (IANA): show current value; allow change on **both** platforms (web today only auto-sets on opt-in).

3. **Quiet hours** (only when master push is on)
   - Toggle + start/end → `quietHoursStart` / `quietHoursEnd` (nullable pair, existing API rule: update both together).
   - **Web: add** (iOS already has).

4. **Miss a day** (only when master push is on)
   - Toggle → `missADayEnabled`
   - Short description of when it fires (product copy once #247 behavior is defined).
   - **Requires backend:** implement miss-a-day send + scheduler branch before toggle does anything user-visible.

5. **Friend activity** (or “Social”) (only when master push is on)
   - Toggle → **new** preference field (recommended: `friendRequestNotificationsEnabled` on `notification_preferences`).
   - Gate `sendFriendRequestNotification` in `src/app/api/friends/requests/route.ts`.
   - **Web push:** extend `sendFriendRequestNotification` to fan out via `sendWebPushToUser` (mirror #347 daily reminder pattern).
   - Deep link: define web URL + iOS `deepLink` for friend requests/inbox.

6. **Errors / saving state**
   - Inline error from PATCH failures (both platforms).
   - Disabled controls while saving (iOS has `isSaving`; web has `busy`).

### Out of scope for this ticket (unless product says otherwise)

- Cross-device dedup (“only notify once if iOS + web both enabled”) — keep V1 dual-send.
- Notification history / inbox UI.
- Email/SMS channels.

## Acceptance criteria

- [ ] **Settings → Notifications** entry on **iOS** and **web** opens a dedicated screen (not only an inline section).
- [ ] Screen content and section order **match** between platforms (copy deck in PR or linked Figma).
- [ ] User can control **every shipped notification type** from that screen:
  - [ ] Master push (per device)
  - [ ] Daily reminder (enable, time, frequency, timezone)
  - [ ] Quiet hours (enable, start, end) — **web parity**
  - [ ] Miss a day (enable) — **after** sender + scheduler exist
  - [ ] Friend requests (enable) — **after** preference column + API gate exist
- [ ] Disabling master push disables dependent toggles in UI and persists `pushEnabled: false` (and unsubscribes web / disables token on iOS as today).
- [ ] All changes persist via `PATCH /api/notifications/preferences` (and device registration endpoints as today).
- [ ] Unit tests for new preference field + friend-request gate; scheduler tests for miss-a-day when implemented.
- [ ] E2E or manual matrix: iOS Settings → Notifications; web Settings → Notifications; verify PATCH round-trip.

## Implementation checklist

### A. Product / copy

- [ ] Final strings for each toggle and helper (including miss-a-day schedule description).
- [ ] Confirm friend-request toggle default (on vs off for existing users).

### B. Backend

- [ ] Add `friend_request_notifications_enabled` (name TBD) to `notification_preferences` + migration + PATCH validation.
- [ ] Gate `sendFriendRequestNotification` on master push + friend toggle.
- [ ] Implement miss-a-day: `sendMissADayNotification`, scheduler branch, gating on `missADayEnabled` (coordinate with #247).
- [ ] Fan out friend-request (and miss-a-day when added) to **web push** where applicable.
- [ ] Document new fields in `docs/notifications.md`.

### C. iOS

- [ ] Extract NOTIFICATIONS block from `SettingsView.swift` into `NotificationsSettingsView` (or equivalent).
- [ ] Add Settings row **Notifications** → push destination.
- [ ] Add UI: miss-a-day toggle, friend-request toggle, timezone picker/display.
- [ ] Wire PATCH fields in `NotificationPreferencesViewModel`.
- [ ] Handle notification tap `type` for friend request / miss-a-day if new deep links added.

### D. Web

- [ ] Add Settings link to `/app/settings/notifications` (or chosen route).
- [ ] Move `WebNotificationSettings` into dedicated page; add quiet hours, miss-a-day, friend-request, timezone edit.
- [ ] Align component structure with iOS section order.

### E. QA

- [ ] Preferences sync: change on web, reload iOS (same account) and vice versa.
- [ ] Verify cron still respects quiet hours + frequency after UI moves.
- [ ] Friend request off → no push on new request; on → push on iOS + web.

## Current file map (starting points)

| Layer | Path |
|-------|------|
| API | `src/app/api/notifications/preferences/route.ts` |
| Prefs model | `src/lib/notification-preferences.ts` |
| Scheduler | `src/lib/notification-scheduler.ts` |
| Send helpers | `src/lib/notifications.ts`, `src/lib/notifications/daily-reminder.ts` |
| Web UI | `src/components/WebNotificationSettings.tsx`, `src/components/SettingsView.tsx` |
| iOS UI | `ios/StillPointApp/Views/SettingsView.swift`, `NotificationPreferencesViewModel.swift` |
| Docs | `docs/notifications.md` |

## Gap summary (what this ticket delivers)

| Gap | Work |
|-----|------|
| Not a dedicated **Notifications** screen | New route/view on web; navigation push on iOS |
| Web missing quiet hours | UI + PATCH (API ready) |
| Miss-a-day not controllable | UI + backend sender/scheduler (#247) |
| Friend requests not controllable | New preference + gate + optional web push |
| Friend / miss-a-day not on web push | Extend send helpers |
| Timezone not editable on web | Timezone picker |
| iOS/web layout drift | Shared copy + section order spec |

---

**Do not claim parity until all rows in “Acceptance criteria” are checked.** #347 (web push for daily reminder) is a prerequisite channel layer, not a complete Notifications settings product.
