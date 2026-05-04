import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { headers } from "next/headers";

export const SP_TOKEN_COOKIE = "sp_token";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createToken(payload: { userId: string; email: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as { userId: string; email: string };
  } catch {
    return null;
  }
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SP_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SP_TOKEN_COOKIE);
}

export async function getCurrentUser(): Promise<{ userId: string; email: string } | null> {
  const cookieStore = await cookies();
  const tokenFromCookie = cookieStore.get(SP_TOKEN_COOKIE)?.value;
  const authorization = (await headers()).get("authorization");
  const tokenFromBearer =
    authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null;
  const token = tokenFromBearer ?? tokenFromCookie;
  if (!token) return null;
  return verifyToken(token);
}
