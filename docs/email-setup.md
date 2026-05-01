# Production email (password reset)

This runbook covers **Resend** as the transactional provider for password reset mail. Code lives in `src/lib/email.ts` and `src/app/api/auth/password-reset/request/route.ts`.

## What the app needs

| Variable | Scope | Purpose |
|----------|--------|---------|
| `RESEND_API_KEY` | Server only | Authenticates to Resend’s API. Never commit; set in Vercel (and locally only in `.env.local`). |
| `EMAIL_FROM` | Server only | Verified sender, e.g. `Still Point <noreply@still-point.me>`. Must match a domain or sender verified in Resend. |
| `NEXT_PUBLIC_APP_URL` | Build / server | Preferred base URL for reset links (`…/reset-password?token=…`). **Recommended** in every Vercel scope. If omitted: Vercel **Production** (`VERCEL_ENV=production`) falls back to `https://still-point.me`; Vercel **Preview** falls back to `https://${VERCEL_URL}` (set automatically by Vercel) so links stay on the same preview deploy as the token; non-Vercel `NODE_ENV=production` (no `VERCEL_ENV` / `VERCEL_URL`) also falls back to `https://still-point.me`; otherwise **local** falls back to `http://127.0.0.1:3000`. Resolution order: `NEXT_PUBLIC_APP_URL` → `VERCEL_ENV` → `VERCEL_URL` → `NODE_ENV` (`src/lib/email.ts`). |

If `EMAIL_FROM` or `RESEND_API_KEY` is missing, behavior is gated on `NODE_ENV` (not `VERCEL_ENV`):

- **`NODE_ENV !== "production"` (local dev / `next dev`):** the app skips sending and logs the reset URL server-side for debugging.
- **`NODE_ENV === "production"` (any Vercel deploy — Production *or* Preview, plus self-hosted prod):** `sendEmail` throws; the request handler rolls back the new token and still returns the same generic success message as unknown emails (no account enumeration). **Vercel Preview deploys therefore require `EMAIL_FROM` + `RESEND_API_KEY` to actually deliver a reset email** — without them, the request silently fails. If you need log-only behavior on Preview, gate `sendEmail` on `VERCEL_ENV !== "production"` instead of `NODE_ENV`.

## Resend account and API key

1. Sign up at [Resend](https://resend.com).
2. **API Keys** → create a key with send permission. Store it only in Vercel **Production** (and Preview if you test real sends on previews).

## Domain verification and DNS

1. In Resend, **Domains** → **Add domain** → enter `still-point.me` (or the subdomain you send from, e.g. if you use only `mail.still-point.me`, follow Resend’s wizard for that host).
2. Add the DNS records Resend shows (typically **SPF** and **DKIM**; they may also show a verification TXT record). Exact names and values are in the dashboard — copy them into your DNS host (often the same place as `still-point.me` nameservers).
3. Wait for verification to turn green in Resend before relying on production deliverability.

**SPF:** Resend usually instructs you to include their SPF include on the domain you send from. Do not remove existing authorized senders your team still needs; merge includes per your DNS provider’s guidance.

**DKIM:** Publish the CNAME (or TXT) records exactly as Resend lists. Typos or proxy/CDN orange-cloud on mail-related records often break verification.

## Vercel environment variables

In **Vercel** → your project → **Settings** → **Environment Variables**:

**Production** (minimum for real reset mail):

```text
RESEND_API_KEY=re_...          # from Resend dashboard
EMAIL_FROM=Still Point <noreply@still-point.me>
NEXT_PUBLIC_APP_URL=https://still-point.me
```

- Scope each variable to **Production** (and **Preview** only if you intentionally test real email from preview deploys).
- Redeploy after changing env vars so the runtime picks them up.

**Preview** scope: if you want preview builds to send via Resend to a test inbox, copy the three vars (or at least `EMAIL_FROM` + `RESEND_API_KEY`) into Preview. Without those keys, Preview password-reset requests **fail silently** (token rollback, generic success response, no email, no logged link) because Vercel sets `NODE_ENV=production` on Preview deploys. This is *not* the dev log-only path — that only applies to local `next dev`.

## Smoke test (production)

1. Use a real account that exists in **production** DB.
2. Request a password reset from the prod site (forgot-password flow).
3. Confirm the message arrives and the link opens `https://still-point.me/reset-password?token=...` (or your configured `NEXT_PUBLIC_APP_URL` + `/reset-password`).
4. Complete the flow and sign in with the new password.
5. **Unknown email:** submit a reset for an address that is not registered. Response must be the same generic success as for a known address (no “user not found” or different status).

## Maintenance notes

- Rotate `RESEND_API_KEY` in Resend and Vercel together; redeploy after updating Vercel.
- If links point at the wrong host, fix `NEXT_PUBLIC_APP_URL` for that environment and redeploy.
- For schema or auth-token changes affecting resets, coordinate with production DB migrations before enabling heavy traffic (see related issue #258 in the tracker).
