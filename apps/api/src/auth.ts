import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

interface SessionPayload extends AuthenticatedUser {
  expiresAt: number;
}

export const createSessionCookie = (user: AuthenticatedUser): string => {
  const expiresAt = Math.floor(Date.now() / 1000) + config.sessionTtlSeconds;
  const payload: SessionPayload = { ...user, expiresAt };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return [
    `${config.sessionCookieName}=${encodedPayload}.${signature}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${config.sessionTtlSeconds}`,
  ].join("; ");
};

export const clearSessionCookie = (): string => {
  return [
    `${config.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
};

export const getAuthenticatedUser = (
  event: APIGatewayProxyEventV2,
): AuthenticatedUser | undefined => {
  const cookie = getCookie(event, config.sessionCookieName);
  if (!cookie) {
    return undefined;
  }

  const [encodedPayload, signature] = cookie.split(".");
  if (
    !encodedPayload ||
    !signature ||
    !verifySignature(encodedPayload, signature)
  ) {
    return undefined;
  }

  try {
    const payload = JSON.parse(
      base64UrlDecode(encodedPayload),
    ) as SessionPayload;
    if (
      !payload.userId ||
      !payload.email ||
      payload.expiresAt < Math.floor(Date.now() / 1000)
    ) {
      return undefined;
    }

    return {
      userId: payload.userId,
      email: payload.email,
    };
  } catch {
    return undefined;
  }
};

const getCookie = (
  event: APIGatewayProxyEventV2,
  name: string,
): string | undefined => {
  const cookieHeaders = [
    ...(event.cookies ?? []),
    event.headers.cookie,
    event.headers.Cookie,
  ].filter((value): value is string => Boolean(value));

  for (const header of cookieHeaders) {
    for (const part of header.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (rawName === name) {
        return rawValue.join("=");
      }
    }
  }

  return undefined;
};

const sign = (value: string): string => {
  return createHmac("sha256", config.sessionSigningSecret)
    .update(value)
    .digest("base64url");
};

const verifySignature = (value: string, signature: string): boolean => {
  const expected = sign(value);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
};

const base64UrlEncode = (value: string): string => {
  return Buffer.from(value, "utf8").toString("base64url");
};

const base64UrlDecode = (value: string): string => {
  return Buffer.from(value, "base64url").toString("utf8");
};
