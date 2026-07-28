import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createInMemoryPhotoObjectStore } from "./in-memory-photo-object-store.js";
import { createS3PhotoObjectStore } from "./s3-photo-object-store.js";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn(),
}));

const signedUrl = jest.mocked(getSignedUrl);

describe("S3PhotoObjectStore", () => {
  it("deletes every supplied key in one S3 request, where missing keys remain a success", async () => {
    const commands: unknown[] = [];
    const store = createS3PhotoObjectStore({
      s3Client: { send: async (command: unknown) => { commands.push(command); return {}; } } as unknown as S3Client,
      bucketName: "photos-bucket",
      uploadUrlExpiresInSeconds: 900,
    });

    await store.deleteObjects(["original", "missing-thumbnail"]);
    await store.deleteObjects([]);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteObjectsCommand);
    expect((commands[0] as DeleteObjectsCommand).input).toEqual({
      Bucket: "photos-bucket",
      Delete: { Objects: [{ Key: "original" }, { Key: "missing-thumbnail" }], Quiet: true },
    });
  });

  it("fails the deletion when S3 reports even one key-level error", async () => {
    const store = createS3PhotoObjectStore({
      s3Client: { send: async () => ({ Errors: [{ Key: "display", Code: "AccessDenied" }] }) } as unknown as S3Client,
      bucketName: "photos-bucket",
      uploadUrlExpiresInSeconds: 900,
    });

    await expect(store.deleteObjects(["original", "display"])).rejects.toThrow("display");
  });
  it("presigns uploads with their content type, metadata, and configured expiry", async () => {
    const commands: unknown[] = [];
    signedUrl.mockResolvedValue("https://signed.example/upload");
    const store = createS3PhotoObjectStore({
      s3Client: {
        send: async (command: unknown) => {
          commands.push(command);
          return {};
        },
      } as unknown as S3Client,
      bucketName: "photos-bucket",
      uploadUrlExpiresInSeconds: 900,
    });

    await expect(
      store.presignUpload({
        objectKey: "originals/user-1/batch-1/photo-1",
        contentType: "image/jpeg",
        metadata: { "user-id": "user-1" },
      }),
    ).resolves.toEqual({ url: "https://signed.example/upload", expiresInSeconds: 900 });

    expect(signedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: {
          Bucket: "photos-bucket",
          Key: "originals/user-1/batch-1/photo-1",
          ContentType: "image/jpeg",
          Metadata: { "user-id": "user-1" },
        },
      }),
      { expiresIn: 900 },
    );
    expect(commands).toEqual([]);
  });

  it("presigns downloads for 300 seconds and sanitizes an attachment filename", async () => {
    signedUrl.mockResolvedValue("https://signed.example/download");
    const store = createS3PhotoObjectStore({
      s3Client: {} as S3Client,
      bucketName: "photos-bucket",
      uploadUrlExpiresInSeconds: 900,
    });

    await expect(
      store.presignDownload({
        objectKey: "originals/user-1/batch-1/photo-1",
        attachmentFileName: 'beach"\\\r\n.jpg',
      }),
    ).resolves.toEqual({ url: "https://signed.example/download", expiresInSeconds: 300 });

    expect(signedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: {
          Bucket: "photos-bucket",
          Key: "originals/user-1/batch-1/photo-1",
          ResponseContentDisposition: 'attachment; filename="beach____.jpg"',
        },
      }),
      { expiresIn: 300 },
    );
  });

  it("reads object metadata and bytes, then writes derived JPEGs", async () => {
    const commands: Array<GetObjectCommand | HeadObjectCommand | PutObjectCommand> = [];
    const originalBytes = Uint8Array.from([1, 2, 3]);
    const store = createS3PhotoObjectStore({
      s3Client: {
        send: async (command: GetObjectCommand | HeadObjectCommand | PutObjectCommand) => {
          commands.push(command);
          if (command instanceof HeadObjectCommand) return { Metadata: { "user-id": "user-1" } };
          if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => originalBytes } };
          return {};
        },
      } as unknown as S3Client,
      bucketName: "photos-bucket",
      uploadUrlExpiresInSeconds: 900,
    });

    await expect(store.readObjectMetadata("original")).resolves.toEqual({ "user-id": "user-1" });
    await expect(store.readObjectBytes("original")).resolves.toEqual(originalBytes);
    await store.writeJpegObject({ objectKey: "display/user-1/photo-1.jpg", body: Uint8Array.from([4, 5]) });

    expect(commands.map((command) => command.input)).toEqual([
      { Bucket: "photos-bucket", Key: "original" },
      { Bucket: "photos-bucket", Key: "original" },
      { Bucket: "photos-bucket", Key: "display/user-1/photo-1.jpg", Body: Uint8Array.from([4, 5]), ContentType: "image/jpeg" },
    ]);
  });
});

describe("InMemoryPhotoObjectStore", () => {
  it("round-trips derived JPEG bytes and seeded original metadata", async () => {
    const originalBytes = Uint8Array.from([1, 2, 3]);
    const store = createInMemoryPhotoObjectStore([
      {
        objectKey: "originals/user-1/batch-1/photo-1",
        body: originalBytes,
        contentType: "image/jpeg",
        metadata: { "user-id": "user-1" },
      },
    ]);

    await expect(store.readObjectBytes("originals/user-1/batch-1/photo-1")).resolves.toEqual(originalBytes);
    await expect(store.readObjectMetadata("originals/user-1/batch-1/photo-1")).resolves.toEqual({ "user-id": "user-1" });
    await store.writeJpegObject({ objectKey: "display/user-1/photo-1.jpg", body: Uint8Array.from([4, 5]) });
    await expect(store.readObjectBytes("display/user-1/photo-1.jpg")).resolves.toEqual(Uint8Array.from([4, 5]));
    await expect(store.presignDownload({ objectKey: "display/user-1/photo-1.jpg" })).resolves.toEqual({
      url: "https://photo-objects.invalid/display%2Fuser-1%2Fphoto-1.jpg",
      expiresInSeconds: 300,
    });
  });
});
