import { createHmac } from "node:crypto";
import { createSessionCookie } from "./auth.js";
import { createWithAuth } from "./auth-wrapper.js";
import { ok } from "./http.js";
import { createInMemoryPersonalAlbumStore } from "./store/in-memory-store.js";

const user = { userId: "user-1", email: "user@example.com" };
const eventWith = (cookie: string, location: "cookies" | "cookie" | "Cookie") => ({
  ...(location === "cookies" ? { cookies: [cookie] } : {}),
  headers: location === "cookie" ? { cookie } : location === "Cookie" ? { Cookie: cookie } : {},
});

describe("createWithAuth", () => {
  it("returns 401 for a missing, tampered, or expired Session", async () => {
    const handler = createWithAuth({ store: createInMemoryPersonalAlbumStore() })(async () => ok({ reached: true }));
    const valid = createSessionCookie(user).split("; ")[0]!;
    const [name, value] = valid.split("=");
    const [payload, signature] = value!.split(".");
    const tampered = `${name}=${payload}.${signature![0] === "a" ? "b" : "a"}${signature!.slice(1)}`;
    const expiredPayload = Buffer.from(JSON.stringify({ ...user, expiresAt: 1 })).toString("base64url");
    const expired = `${name}=${expiredPayload}.${createHmac("sha256", "test-secret").update(expiredPayload).digest("base64url")}`;

    for (const event of [{ headers: {} }, eventWith(tampered, "cookies"), eventWith(expired, "cookies")]) {
      await expect(handler(event as never, {} as never, jest.fn())).resolves.toMatchObject({
        statusCode: 401,
        body: JSON.stringify({ message: "Unauthorized" }),
      });
    }
  });

  it.each(["cookies", "cookie", "Cookie"] as const)("verifies a valid Session from %s and injects its Personal Album", async (location) => {
    const store = createInMemoryPersonalAlbumStore();
    await store.personalAlbumOf(user.userId).createPhoto({
      photoId: "photo-1",
      uploadBatchId: "batch-1",
      originalObjectKey: "originals/user-1/batch-1/photo-1",
      fileName: "photo.jpg",
      format: "jpeg",
      contentType: "image/jpeg",
      fileSizeBytes: 1,
      uploadRequestedAt: "2026-07-19T00:00:00.000Z",
    });
    const handler = createWithAuth({ store })(async (context) => {
      expect(context.user).toEqual(user);
      await expect(context.album.getPhoto("photo-1")).resolves.toMatchObject({ userId: "user-1" });
      return ok({ userId: context.user.userId });
    });
    const response = await handler(eventWith(createSessionCookie(user).split("; ")[0]!, location) as never, {} as never, jest.fn());
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ userId: "user-1" }) });
  });
});
