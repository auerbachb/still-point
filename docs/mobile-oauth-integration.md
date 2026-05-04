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
4. Requires `email_verified` true (Apple sends boolean or string `"true"`).
5. Uses **`sub`** as the stable Apple account identifier. Lookup order matches web OAuth (`src/lib/oauth-user-resolution.ts`): existing `(provider='apple', provider_account_id=sub)` row wins; otherwise email match for linking or new user creation.

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

## Follow-up work (not shipped here)

- **#338** — Server-to-server Apple notifications (account deleted, consent revoked, email disabled).
- **#339** — Register outbound email sources for Apple Private Email Relay deliverability.

---

## Other providers

Google / Microsoft / Facebook on mobile would follow the same **pattern**: native SDK obtains tokens → server route verifies tokens / exchanges codes → `resolveOAuthUserId`-style linking → `sp_token`. Only Apple is implemented in this shape today.
