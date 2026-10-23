import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

const key = new TextEncoder().encode(env.SESSION_SECRET);

export const SESSION_COOKIE = "sy_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function signSession(claims: { userId: string; restaurantId: string }) {
  return new SignJWT({ rid: claims.restaurantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer("sarfaresh")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key);
}

export async function readSessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "sarfaresh",
    });
    if (typeof payload.sub !== "string" || typeof payload.rid !== "string") return null;
    return { userId: payload.sub, restaurantId: payload.rid };
  } catch {
    return null;
  }
}