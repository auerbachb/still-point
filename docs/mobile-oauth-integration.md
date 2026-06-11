# Mobile OAuth integration (native iOS)

This document describes how the Still Point iOS app completes OAuth-style sign-in **outside** Auth.js’s browser-only OAuth flow. Auth.js handles **web** redirects (`/api/auth/callback/…`); native apps receive Apple credentials locally and must verify them on the server.

## Sign in with Apple (native)

### Endpoint

`POST /api/auth/apple-native`

Public route (no prior `sp_token`). Middleware allows this path without JWT verification.

### Request body (JSON)

| Field | Required | Description |
| --- | --- | --- |
| `identityToken` | Yes | UTF-8 string of the JWT from `ASAuthorizationAppleIDCredential.identityToken`. |
| `authorizationCode` | No | Optional opaque authorization code from Apple (included for parity with Apple’s API and future server-side token exchange). Not used for account linking today. |
| `user` | No | Present **only on the first consent** for this Apple ID + client pair. Same shape Apple sends to web (`name.firstName`, `name.lastName`, `email`). Subsequent sign-ins omit this object entirely — **never rely on name/email being present after first launch.** |

### Server validation

1. Verifies `identityToken` with Apple’s JWKS (`https://appleid.apple.com/auth/keys`) via `jose` (`jwtVerify` + `createRemoteJWKSet`).
2. Validates issuer `https://appleid.apple.com`.
3. Validates **audience** against the iOS App ID bundle identifier — **not** the Sign in with Apple **Services ID** used for web (`AUTH_APPLE_ID`). Default audience is `com.brettonauerbach.stillpoint`. Override with optional env **`AUTH_APPLE_IOS_AUDIENCE`** if you use a different bundle ID or multiple apps.
4. When the JWT includes `email`, requires `email_verified` true (boolean or string `"true"`). When `email` is omitted (common on repeat native sign-ins), accepts the token if **`sub`** already maps to an existing `oauth_accounts` row; first-time account creation still requires `email` in the token (Apple sends it on first consent).
5. Uses **`sub`** as the stable Apple account identifier. Lookup order matches web OAuth (`src/lib/oauth-user-resolution.ts`): existing `(provider='apple', provider_account_id=sub)` wins first; otherwise email match or new user creation when email is present.

### Response

- JSON `{ user, token }` — same shape as email/password login when `X-Still-Point-Client: ios` is used (`token` is the JWT for `Authorization: Bearer`).
- Sets HTTP-only cookie **`sp_token`** for parity with web sessions (Safari / embedded WebViews if applicable).

### Hide My Email (relay)

Relay addresses (`@privaterelay.appleid.com`) are stable per user + app. We store the relay email on first sign-in and **always** resolve returning users by Apple `sub` in `oauth_accounts`, not by mutating email. If the user revokes relay or changes forwarding, sign-in still works.

**Outbound email:** Apple Private Email Relay only delivers mail from **registered** sender domains. Until outgoing mail is registered with Apple (see **#339**), transactional email to relay addresses may not arrive. This does not block sign-in.

### Device testing

Sign in with Apple on the **Simulator is unreliable**. Use a **physical device** and a real Apple ID for acceptance testing.

In **UI test mode** (`SP_UI_TEST_MODE=1`), the app **does not render** the Sign in with Apple button so XCUITest can rely on stable hit-testing for email/password fields; production builds show the button normally.

### Local API development

The native client targets `https://still-point.me` by default (`APIClient`). Point it at a Vercel preview URL if you need to test server changes before production.

---

## Apple server-to-server notifications (#338)

Apple notifies us when a user's relationship with Sign in with Apple changes outside the app: Apple ID deleted, consent revoked, or Hide My Email forwarding toggled.

### Endpoint

`POST /api/auth/apple/notifications`

Public route — Apple's servers post here with no `sp_token`; middleware allows the path and the route authenticates the request by verifying the Apple-signed JWT itself.

### Request body and verification

Apple sends `{"payload": "<JWS>"}`. The route verifies the JWT via `src/lib/apple-auth.ts`:

1. Signature against Apple's JWKS (`https://appleid.apple.com/auth/keys`, `jose` remote key set).
2. Issuer `https://appleid.apple.com`.
3. Audience must be one of our client IDs: the App ID bundle identifier (`AUTH_APPLE_IOS_AUDIENCE`, default `com.brettonauerbach.stillpoint` — notifications are configured on the App ID) or the web Services ID (`AUTH_APPLE_ID`).

Requests that fail JWT verification return **401** and are not processed — they are not from Apple (or the audience is misconfigured, which should fail loudly rather than be silently swallowed). The JWT's `events` claim is a JSON string holding one event: `{ "type", "sub", "event_time", … }`.

### Event handling (`src/lib/apple-notifications.ts`)

| `events.type` | Action |
| --- | --- |
| `account-delete` / `account-deleted` | Deletes the app account via the **same transactional path as in-app deletion (#158)** — `deleteUserAccount()` cascades user data and writes `account_deletion_log`. (Apple's reference documents `account-deleted`; both spellings are accepted.) |
| `consent-revoked` | Deletes the `oauth_accounts` Apple link so the next sign-in requires fresh consent. Active sessions are stateless `sp_token` JWTs that age out at the 7-day expiry; a token blocklist is explicitly out of scope. |
| `email-disabled` | Sets `users.email_deliverable = false` — outbound mail to the (relay) address will bounce. |
| `email-enabled` | Sets `users.email_deliverable = true`. |
| anything else | Logged with `action_taken = ignored_unknown_event_type`, no state change. |

**Idempotency:** every handler tolerates already-processed state (user already deleted, link already removed, flag already set), so the same notification posted twice produces the same end state. Apple does **not** document retry or delivery-guarantee semantics for these notifications — processing failures therefore return 500 **and** are logged (`console.error` → Vercel logs) for manual follow-up; if Apple or an operator redelivers, the idempotent handlers make that safe.

**Audit log:** every verified notification — including duplicates and unknown types — appends a row to `apple_notification_log` (event type, Apple `sub`, Apple event time, JWT `jti`, affected user id, action taken, received time).

### Operator setup (one-time, Apple Developer console)

1. [developer.apple.com](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles → Identifiers** → App ID `com.brettonauerbach.stillpoint`.
2. **Sign in with Apple → Edit** → set **Server-to-Server Notification Endpoint** to `https://still-point.me/api/auth/apple/notifications` → Save.

Notifications for the whole App ID group (including the web Services ID flow) are delivered to this endpoint.

### End-to-end verification

On a device signed in with Apple: **Settings → [your name] → Sign-In & Security → Sign in with Apple → Still Point → Stop Using Apple ID** (or [account.apple.com](https://account.apple.com) → Sign-In and Security). Within ~30s expect:

- a `consent-revoked` row in `apple_notification_log` with `action_taken = apple_link_removed`, and the user's `oauth_accounts` Apple row gone;
- for an Apple ID **account deletion**, an `account-delete`/`account-deleted` row with `action_taken = account_deleted`, the `users` row gone, and an `account_deletion_log` entry.

---

## Follow-up work (not shipped here)

- **#339** — Register outbound email sources for Apple Private Email Relay deliverability.

---

## Other providers

Google / Microsoft / Facebook on mobile would follow the same **pattern**: native SDK obtains tokens → server route verifies tokens / exchanges codes → `resolveOAuthUserId`-style linking → `sp_token`. Only Apple is implemented in this shape today.
