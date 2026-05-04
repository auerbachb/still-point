import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { getAppleClientSecret } from "@/lib/apple-client-secret";
import { resolveOAuthUserId } from "@/lib/oauth-user-resolution";

declare module "next-auth" {
  interface Session {
    userId?: string;
  }
}

function isEmailVerifiedForProvider(
  provider: string,
  profile: { email_verified?: string | boolean | undefined },
): boolean {
  if (provider === "google") {
    return true;
  }
  if (provider === "apple") {
    const ev = profile.email_verified;
    return ev === true || ev === "true";
  }
  return profile.email_verified === true;
}

const appleEnvReady =
  Boolean(process.env.AUTH_APPLE_ID) &&
  Boolean(process.env.APPLE_TEAM_ID) &&
  Boolean(process.env.APPLE_KEY_ID) &&
  Boolean(process.env.APPLE_PRIVATE_KEY);

const appleClientSecretForWeb = appleEnvReady ? await getAppleClientSecret() : undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
    ...(appleClientSecretForWeb
      ? [
          Apple({
            clientId: process.env.AUTH_APPLE_ID!,
            clientSecret: appleClientSecretForWeb,
          }),
        ]
      : []),
  ],
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

      if (!isEmailVerifiedForProvider(provider, profile as { email_verified?: string | boolean })) {
        return false;
      }

      const email = rawEmail.trim().toLowerCase();

      const userId = await resolveOAuthUserId({
        provider,
        providerAccountId,
        email,
        profile: { name: typeof profile.name === "string" ? profile.name : null },
      });

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
      const normalizedUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;

      if (
        normalizedUrl.startsWith(`${baseUrl}/app`) &&
        /[?&]error=/.test(normalizedUrl)
      ) {
        return normalizedUrl;
      }

      if (normalizedUrl.startsWith(`${baseUrl}/api/auth/oauth-complete`)) {
        return normalizedUrl;
      }

      if (normalizedUrl.startsWith(baseUrl)) {
        const target = normalizedUrl.slice(baseUrl.length) || "/app";
        return `${baseUrl}/api/auth/oauth-complete?return=${encodeURIComponent(target)}`;
      }

      return `${baseUrl}/api/auth/oauth-complete`;
    },
  },
});
