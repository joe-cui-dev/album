import { config } from "./config.js";

export interface AllowedUser {
  userId: string;
  email: string;
}

const userIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;

export const getAllowedUsers = (): AllowedUser[] => {
  return config.userAllowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseAllowlistEntry);
};

export const findAllowedUserByEmail = (
  email: string,
): AllowedUser | undefined => {
  const normalizedEmail = normalizeEmail(email);
  return getAllowedUsers().find((user) => user.email === normalizedEmail);
};

export const normalizeEmail = (email: string): string => {
  return email.trim().toLowerCase();
};

const parseAllowlistEntry = (entry: string): AllowedUser => {
  const [userId, email, ...rest] = entry.split(":");
  if (!userId || !email || rest.length > 0) {
    throw new Error(
      "Invalid USER_ALLOWLIST entry. Expected comma-separated userId:email pairs.",
    );
  }

  if (!userIdPattern.test(userId)) {
    throw new Error(`Invalid USER_ALLOWLIST userId: ${userId}`);
  }

  return {
    userId,
    email: normalizeEmail(email),
  };
};
