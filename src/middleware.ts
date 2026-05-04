import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "sp_token";

const publicExactPaths = [
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/apple-native",
  "/api/auth/google/callback",
  "/api/auth/oauth-complete",
  // Auth.js v5 catch-all routes (#136) — bare endpoints. The catch-all
  // lives at /api/auth/[...nextauth]; these and the prefixed variants
  // below need to bypass sp_token verification because Auth.js manages
  // its own short-lived session cookie during the OAuth dance, and
  // oauth-complete (above) hands off to sp_token afterwards.
  "/api/auth/signin",
  "/api/auth/callback",
  "/api/auth/csrf",
  "/api/auth/session",
  "/api/auth/providers",
  "/api/auth/error",
];

const publicPrefixPaths = [
  "/api/board",
  "/api/auth/password-reset",
  // Auth.js sub-paths (provider variants). Use trailing `/` so a future
  // route like /api/auth/signin-admin would NOT silently bypass auth.
  "/api/auth/signin/",
  "/api/auth/callback/",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow public routes
  if (
    publicExactPaths.includes(pathname) ||
    publicPrefixPaths.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  // /api/auth/me handles its own auth check
  if (pathname === "/api/auth/me") {
    return NextResponse.next();
  }

  // Protected routes need valid JWT
  const tokenFromCookie = request.cookies.get(COOKIE_NAME)?.value;
  const authorization = request.headers.get("authorization");
  const tokenFromBearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const token = tokenFromBearer ?? tokenFromCookie;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);

    const response = NextResponse.next();
    response.headers.set("x-user-id", payload.userId as string);
    response.headers.set("x-user-email", payload.email as string);
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
