import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { getAppleClientSecret } from "@/lib/apple-client-secret";
import { resolveOrCreateUserForOAuthLink } from "@/lib/oauth-account-resolution";

declare module "next-auth" {
  interface Session {
    userId?: string;
  }
}

const googleProvider = Google({
  clientId: process.env.AUTH_GOOGLE_ID,
  clientSecret: process.env.AUTH_GOOGLE_SECRET,
  authorization: { params: { scope: "openid email profile" } },
});

const appleConfigured =
  Boolean(process.env.AUTH_APPLE_ID) &&
  Boolean(process.env.APPLE_TEAM_ID) &&
  Boolean(process.env.APPLE_KEY_ID) &&
  Boolean(process.env.APPLE_PRIVATE_KEY);

const appleProvider = Apple({
  clientId: process.env.AUTH_APPLE_ID!,
  // Auth.js resolves this at token exchange; runtime accepts async factory though types say string.
  clientSecret: getAppleClientSecret as unknown as string,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [googleProvider, ...(appleConfigured ? [appleProvider] : [])],
  // Only override `error`. Setting `pages.signIn` to a custom path tells
  // Auth.js v5 that we render our own signin UI on that path, which
  // changes the routing — the built-in `/api/auth/signin/<provider>`
  // route then expects to be reached only via POST+CSRF from that page.
  // We don't need a custom signin page: AuthScreen renders at /app
  // whenever sp_token is missing, completely outside Auth.js's flow. The
  // `signIn()` helper in AuthScreen handles POST+CSRF automatically.
  pages: {
    error: "/app",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !profile) return false;
      const rawEmail = typeof profile.email === "string" ? profile.email : null;
      if (!rawEmail) return false;

      const provider = account.provider;
      const providerAccountId = account.providerAccountId;
      if (!provider || !providerAccountId) return false;

      // Per-provider email-verification check. Auth.js v5 normalises the
      // raw OIDC `profile` through each provider's `profile()` mapper
      // BEFORE this callback fires, and Google's default mapper strips
      // `email_verified`. The signal we trust instead:
      //   - Google: granting the `email` scope returns a verified address
      //     by Google's own contract; presence of `profile.email` here is
      //     the verification signal.
      //   - Apple: OIDC `email_verified` from the id_token (mapped onto profile).
      //   - Other providers (Microsoft / Facebook, deferred):
      //     require an explicit `email_verified === true` claim.
      const p = profile as { email_verified?: boolean | string };
      const emailVerified =
        provider === "google"
          ? true
          : provider === "apple"
            ? p.email_verified === true || p.email_verified === "true"
            : p.email_verified === true;
      if (!emailVerified) return false;

      const email = rawEmail.trim().toLowerCase();
      const profileName = typeof profile.name === "string" && profile.name ? profile.name : null;

      const userId = await resolveOrCreateUserForOAuthLink({
        provider,
        providerAccountId,
        email,
        profileName,
      });

      // Auth.js passes `user` into the jwt callback only on initial sign-in;
      // overwriting `user.id` here is how we hand the database id to the JWT.
      user.id = userId;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      const tokenUserId = (token as { userId?: unknown }).userId;
      if (typeof tokenUserId === "string") {
        session.userId = tokenUserId;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Auth.js may invoke this callback with a relative same-origin path
      // (e.g. "/app?error=AccessDenied" or a relative `callbackUrl`).
      // Normalise to an absolute URL up front so the comparisons below
      // match both relative and absolute forms — without this, relative
      // values fell through to the final fallback and lost their error /
      // deep-link state.
      const normalizedUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;

      // Auth.js error redirects (e.g. /app?error=AccessDenied,
      // /app?error=OAuthCallback) come through here when sign-in fails or
      // is cancelled. Identify them by the explicit ?error= query param
      // and pass through unchanged so AuthScreen renders the inline error.
      // The earlier broader rule (any /app URL) was too wide — the default
      // post-sign-in callbackUrl is also /app, which would bypass the
      // sp_token bridge entirely.
      if (
        normalizedUrl.startsWith(`${baseUrl}/app`) &&
        /[?&]error=/.test(normalizedUrl)
      ) {
        return normalizedUrl;
      }

      // Already in our sp_token bridge. Pass through.
      if (normalizedUrl.startsWith(`${baseUrl}/api/auth/oauth-complete`)) {
        return normalizedUrl;
      }

      // Successful sign-in (or any other same-origin destination): route
      // through the bridge so sp_token is minted before the user lands on
      // the SPA. Encode the original target as ?return= so the bridge can
      // honour deep-link/callbackUrl state after minting the cookie.
      if (normalizedUrl.startsWith(baseUrl)) {
        const target = normalizedUrl.slice(baseUrl.length) || "/app";
        return `${baseUrl}/api/auth/oauth-complete?return=${encodeURIComponent(target)}`;
      }

      // Off-origin URL (defensive). Drop and use the bridge default.
      return `${baseUrl}/api/auth/oauth-complete`;
    },
  },
});
