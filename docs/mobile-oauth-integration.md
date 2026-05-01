# Mobile OAuth Integration (iOS)

This document defines the architecture and API contract the iOS app uses to
sign in users via the same OAuth providers offered on the web. It is the
companion spec for issue #136 (web Google sign-in) and follow-ups
[#284](https://github.com/auerbachb/still-point/issues/284) (Microsoft),
[#285](https://github.com/auerbachb/still-point/issues/285) (Facebook), and
[#286](https://github.com/auerbachb/still-point/issues/286) (Apple).

The iOS implementation itself ships in a separate iOS-side issue. This file
describes only what the web backend already supports today and what each
provider expects from the client.

---

## Account model

A single Still Point user account can have:

- An optional password (stored as a bcrypt hash in `users.password_hash`,
  nullable as of #136).
- Zero or more linked OAuth identities, recorded in `oauth_accounts` as
  `(provider, provider_account_id) -> user_id`.

Linking rule: when a sign-in provider returns a verified email that matches
an existing `users.email` (case-insensitively), the new
`(provider, provider_account_id)` is attached to that user. Otherwise a new
user is created with a null `password_hash`.

The session token format is unchanged. The web backend mints the same
HttpOnly `sp_token` JWT it has always used; iOS continues to read
`sp_token` from `HTTPCookieStorage.shared` and attach it to subsequent
requests.

---

## Provider integration patterns

There are two patterns iOS uses depending on the provider:

### Pattern A: Native SDK + dedicated server endpoint (Apple only)

Apple requires Sign in with Apple to use `ASAuthorizationController` on iOS
when the platform supports it. The native flow returns an `identityToken`
(JWT signed by Apple) and an `authorizationCode` to the app, not a redirect.

Endpoint (to be implemented under issue
[#286](https://github.com/auerbachb/still-point/issues/286)):

```http
POST /api/auth/apple-native
Content-Type: application/json
```

```json
{
  "identityToken": "<JWS from ASAuthorizationCredential.identityToken>",
  "authorizationCode": "<from ASAuthorizationCredential.authorizationCode>",
  "fullName": { "givenName": "Ada", "familyName": "Lovelace" }
}
```

Server responsibilities:

1. Verify `identityToken` against Apple's JWKS
   (`https://appleid.apple.com/auth/keys`) using the `jose` library that is
   already in the project; check `iss == "https://appleid.apple.com"`,
   `aud == AUTH_APPLE_ID` (the Services ID), and `exp`.
2. Extract `sub` (Apple user id, stable across sign-ins) and `email`.
3. Apply the same find/create-and-link logic as the web `signIn` callback,
   keyed on email when present (Apple may return a relay address) and on
   `(provider='apple', provider_account_id=sub)` for re-sign-in.
4. Mint `sp_token`, set the cookie, and return the same response shape as
   `POST /api/auth/login`.

This endpoint does not exist yet. It is gated on
[#286](https://github.com/auerbachb/still-point/issues/286).

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
| Apple | A (native) | `ASAuthorizationController` | Web Auth.js + native endpoint deferred to [#286](https://github.com/auerbachb/still-point/issues/286). |
| Facebook | B (web flow) | `ASWebAuthenticationSession` | Deferred to [#285](https://github.com/auerbachb/still-point/issues/285). |
| Microsoft | B (web flow) | `ASWebAuthenticationSession` | Web available (#284). iOS-side issue not yet filed. |

---

## Security expectations (all providers)

- Verify provider tokens server-side; never trust client-supplied user
  identifiers.
- Provider tokens (`identityToken`, OAuth access tokens, refresh tokens)
  must not appear in application logs. Auth.js does not log them by default;
  custom server code (e.g., `/api/auth/apple-native`) must follow the same
  rule.
- `sp_token` remains the only credential the iOS app sees and stores. It is
  HttpOnly on web; on iOS it lives in `HTTPCookieStorage.shared` and is
  attached automatically by `URLSession`.
- CSRF/state for the OAuth handshake is owned by Auth.js for Pattern B;
  Pattern A endpoints (`/api/auth/apple-native`) do not need CSRF protection
  because the request is a one-shot exchange of a provider-issued JWT.
