const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config = {
  userAllowlist: required("USER_ALLOWLIST"),
  photosBucketName: required("PHOTOS_BUCKET_NAME"),
  metadataTableName: required("METADATA_TABLE_NAME"),
  sessionSigningSecret: required("SESSION_SIGNING_SECRET"),
  sesFromEmail: process.env.SES_FROM_EMAIL,
  allowDevAuthCodes: process.env.ALLOW_DEV_AUTH_CODES === "true",
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "album_session",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? "2592000"),
  signInCodeTtlSeconds: Number(process.env.SIGN_IN_CODE_TTL_SECONDS ?? "600"),
  uploadUrlExpiresInSeconds: Number(
    process.env.UPLOAD_URL_EXPIRES_IN_SECONDS ?? "900",
  ),
};
