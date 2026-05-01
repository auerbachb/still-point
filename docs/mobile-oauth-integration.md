# Mobile OAuth Integration (iOS)

This document defines the architecture and API contract the iOS app uses to
sign in users via the same OAuth providers offered on the web. It is the
companion spec for issue #136 (web Google sign-in) and follow-ups
[#284](https://github.com/auerbachb/still-point/issues/284) (Microsoft),
[#285](https://github.com/auerbachb/still-point/issues/285) (Facebook), and
[#286](https://github.com/auerbachb/still-point/issues/286) (Apple).

---

## Account model

A single Still Point user account can have:

- An optional password (stored as a bcrypt hash in `users.password_hash`,
  nullable as of #136).
- Zero or more linked OAuth identities, recorded in `oauth_accounts` as
  `(provider, provider_account_id) -> user_id`.

Linking rule: **provider identity is authoritative.** On each sign-in we first
look up `(provider, provider_account_id)` in `oauth_accounts`. If a row exists,
that user owns the session — even when the provider-supplied email is a relay
address or changes. If no row exists, we may attach the new identity to an
existing user whose `users.email` matches (case-insensitive), or create a new
user. Shared implementation: `src/lib/oauth-account-resolution.ts` (used by
Auth.js web callbacks and native bridges).

The session token format is unchanged. The web backend mints the same
HttpOnly `sp_token` JWT it has always used; iOS continues to read
`sp_token` from `HTTPCookieStorage.shared` and attach it to subsequent
requests. For native flows, `APIClient` also persists the JWT from the JSON
body when the server returns `token` (header `X-Still-Point-Client: ios`).

---

## Provider integration patterns

There are two patterns iOS uses depending on the provider:

### Pattern A: Native SDK + dedicated server endpoint (Apple)

Apple requires Sign in with Apple to use `ASAuthorizationController` on iOS
when the platform supports it. The native flow returns an `identityToken`
(JWT signed by Apple) and an `authorizationCode` to the app, not a redirect.

Endpoint (implemented under [#286](https://github.com/auerbachb/still-point/issues/286)):

```http
POST /api/auth/apple-native
Content-Type: application/json
X-Still-Point-Client: ios
```

```json
{
  "identityToken": "<JWS from ASAuthorizationCredential.identityToken>",
  "authorizationCode": "<from ASAuthorizationCredential.authorizationCode>",
  "fullName": { "givenName": "Ada", "familyName": "Lovelace" }
}
```

`fullName` is optional; Apple only supplies it on the **first** authorization
for that Apple ID in your app. Omit or send `{}` on subsequent sign-ins.

Server responsibilities:

1. Verify `identityToken` against Apple's JWKS
   (`https://appleid.apple.com/auth/keys`) with `jose.jwtVerify`; require
   `iss === "https://appleid.apple.com"`, valid signature, and `exp`.
2. Require `aud` to be either `AUTH_APPLE_ID` (Services ID / web client id) or
   the iOS host app bundle id (default `com.brettonauerbach.stillpoint`). If
   your bundle id differs, set optional `AUTH_APPLE_NATIVE_ID` on the server.
3. Extract `sub` (Apple user id, stable across sign-ins) and `email` from the
   JWT. Reject if `email` or `email_verified` is missing or false — Apple omits
   `email` on later native sign-ins unless the user revoked and re-granted; in
   that case the user should complete a fresh authorization or use web sign-in
   once so we can store the relay address.
4. Call `resolveOrCreateUserForOAuthLink({ provider: 'apple', providerAccountId: sub, email, profileName })`.
5. Mint `sp_token`, set the HttpOnly cookie, return the same JSON shape as
   `POST /api/auth/login`, plus `token` in the body when `X-Still-Point-Client: ios`.

**Hide My Email:** Relay addresses (`*@privaterelay.appleid.com`) are stable
per (user, app). We always key `oauth_accounts` rows by Apple `sub`, so repeat
sign-ins attach to the same Still Point user even if email matching would
otherwise be ambiguous.

**Security:** Do not log `identityToken`, `authorizationCode`, or provider access
tokens. The route logs only generic errors.

**iOS app wiring:** `AppleSignInController` + `AppleSignInButtonView` in
`ios/StillPointApp` call `APIClient.appleNativeSignIn`. Enable the Sign in with
Apple capability in Xcode / Apple Developer for the app id that matches the
native token `aud`.

### Pattern B: `ASWebAuthenticationSession` over the web flow (Google, Microsoft, Facebook)

For all non-Apple providers, iOS reuses the existing web OAuth flow rather
than carrying provider SDKs. The flow:

1. iOS opens `ASWebAuthenticationSession` pointed at:

   ```text
   https://www.still-point.me/api/auth/signin/<provider>
   ```

   For `<provider>` use the Auth.js id: `google`, `microsoft-entra-id`, or
   `facebook`.

2. The user authenticates with the provider in a system-managed browser tab
   that shares cookies with Safari (set
   `prefersEphemeralWebBrowserSession: false` so returning users do not
   re-enter their password).

3. Auth.js (server) handles `/api/auth/callback/<provider>` and redirects
   to `/api/auth/oauth-complete`. `oauth-complete` mints `sp_token`, sets
   the HttpOnly cookie scoped to `still-point.me`, then redirects to
   `/app`.

4. **Detecting completion on iOS.** The redirect chain ends on `/app` —
   the server does not redirect to a custom URL scheme today, so
   `ASWebAuthenticationSession`'s `callbackURLScheme` completion handler
   does NOT fire automatically. The iOS-side issue (separate from #136)
   will choose one of:
   - **(a)** Have the server redirect to `stillpoint://oauth-complete`
     after `oauth-complete` instead of `/app`, with a server-side
     allow-list keyed off a request marker (e.g. `?ios=1` propagated
     from `signin/<provider>?callbackUrl=...`). This requires a small
     extension to the `redirect` callback in `src/lib/auth-config.ts` so
     known custom schemes survive.
   - **(b)** Poll the session's current URL on a timer; when it reaches
     `https://www.still-point.me/app`, dismiss the session and read
     `sp_token` from `HTTPCookieStorage.shared`.
   Until that decision lands, treat the existing custom-scheme
   registration in `Info.plist` as scaffolding — it does not yet
   round-trip end-to-end.

Caveats for Pattern B:

- The redirect URI registered with each provider must be the **server**
  callback (`https://www.still-point.me/api/auth/callback/<provider>`),
  not the iOS custom scheme. Auth.js owns the OAuth handshake; iOS only
  cares about the final `sp_token` cookie.
- iOS must use `HTTPCookieStorage.shared` (the default) so cookies set
  by the system browser are visible to the app's `URLSession`. Custom
  cookie stores will miss `sp_token`.
- If `sp_token` is unexpectedly absent after the session callback, the
  app should call `GET /api/auth/me` once. If it returns 401, treat the
  attempt as a failed sign-in and surface a retry UI.

---

## Provider-specific notes

| Provider | Pattern | iOS framework | Status |
|---|---|---|---|
| Google | B (web flow) | `ASWebAuthenticationSession` | Web available today (#136). iOS-side issue not yet filed. |
| Apple | A (native) | `ASAuthorizationController` | Web Auth.js + `POST /api/auth/apple-native` (#286). |
| Facebook | B (web flow) | `ASWebAuthenticationSession` | Deferred to [#285](https://github.com/auerbachb/still-point/issues/285). |
| Microsoft | B (web flow) | `ASWebAuthenticationSession` | Deferred to [#284](https://github.com/auerbachb/still-point/issues/284). |

---

## Security expectations (all providers)

- Verify provider tokens server-side; never trust client-supplied user
  identifiers.
- Provider tokens (`identityToken`, OAuth access tokens, refresh tokens)
  must not appear in application logs. Auth.js does not log them by default;
  custom server code (e.g. `/api/auth/apple-native`) must follow the same
  rule.
- `sp_token` remains the only credential the iOS app sees and stores. It is
  HttpOnly on web; on iOS it lives in `HTTPCookieStorage.shared` and is
  attached automatically by `URLSession`.
- CSRF/state for the OAuth handshake is owned by Auth.js for Pattern B;
  Pattern A endpoints (`/api/auth/apple-native`) do not need CSRF protection
  because the request is a one-shot exchange of a provider-issued JWT.
