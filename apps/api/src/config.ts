export const config = {
  ownerEmail: required("OWNER_EMAIL"),
  photosBucketName: required("PHOTOS_BUCKET_NAME"),
  metadataTableName: required("METADATA_TABLE_NAME"),
  uploadUrlExpiresInSeconds: Number(process.env.UPLOAD_URL_EXPIRES_IN_SECONDS ?? "900")
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

