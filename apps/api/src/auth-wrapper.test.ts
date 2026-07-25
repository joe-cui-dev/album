import { createHmac } from "node:crypto";
import { createSessionCookie } from "./auth.js";
import { createWithAuth } from "./auth-wrapper.js";
import { ok } from "./http.js";
import { createInMemoryPersonalAlbumStore } from "./store/in-memory-store.js";

const user = { userId: "user-1", email: "user@example.com" };
const allowedUsers = () => [{ userId: "user-1", email: "user@example.com" }];
const requestContext = (method: string) => ({ http: { method } });
const eventWith = (cookie: string, location: "cookies" | "cookie" | "Cookie") => ({
  ...(location === "cookies" ? { cookies: [cookie] } : {}),
  headers: {
    origin: "https://album.example.com",
    ...(location === "cookie" ? { cookie } : location === "Cookie" ? { Cookie: cookie } : {}),
  },
  requestContext: requestContext("POST"),
});

describe("createWithAuth", () => {
  it("returns 401 for a missing, tampered, or expired Session", async () => {
    const handler = createWithAuth({ store: createInMemoryPersonalAlbumStore(), resolveAllowedUsers: allowedUsers })(async () =>
      ok({ reached: true }),
    );
    const valid = createSessionCookie(user).split("; ")[0]!;
    const [name, value] = valid.split("=");
    const [payload, signature] = value!.split(".");
    const tampered = `${name}=${payload}.${signature![0] === "a" ? "b" : "a"}${signature!.slice(1)}`;
    const expiredPayload = Buffer.from(JSON.stringify({ ...user, expiresAt: 1 })).toString("base64url");
    const expired = `${name}=${expiredPayload}.${createHmac("sha256", "test-secret").update(expiredPayload).digest("base64url")}`;

    for (const event of [
      { headers: { origin: "https://album.example.com" }, requestContext: requestContext("POST") },
      eventWith(tampered, "cookies"),
      eventWith(expired, "cookies"),
    ]) {
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
      uploadLocalDateTime: "2026-07-19T00:00:00",
      uploadContextTimeZone: "UTC",
    });
    const handler = createWithAuth({ store, resolveAllowedUsers: allowedUsers })(async (context) => {
      expect(context.user).toEqual(user);
      await expect(context.album.getPhoto("photo-1")).resolves.toMatchObject({ userId: "user-1" });
      return ok({ userId: context.user.userId });
    });
    const response = await handler(eventWith(createSessionCookie(user).split("; ")[0]!, location) as never, {} as never, jest.fn());
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ userId: "user-1" }) });
  });

  it("rejects a mutation from a disallowed Origin before checking the Session", async () => {
    const handler = createWithAuth({ store: createInMemoryPersonalAlbumStore(), resolveAllowedUsers: allowedUsers })(async () =>
      ok({ reached: true }),
    );
    const event = {
      cookies: [createSessionCookie(user).split("; ")[0]!],
      headers: { origin: "https://evil.example.com" },
      requestContext: requestContext("POST"),
    };
    await expect(handler(event as never, {} as never, jest.fn())).resolves.toMatchObject({
      statusCode: 403,
      body: JSON.stringify({ code: "origin_rejected", message: "Forbidden" }),
    });
  });

  it("exempts GET from the Origin check", async () => {
    const handler = createWithAuth({ store: createInMemoryPersonalAlbumStore(), resolveAllowedUsers: allowedUsers })(async () =>
      ok({ reached: true }),
    );
    const event = {
      cookies: [createSessionCookie(user).split("; ")[0]!],
      headers: {},
      requestContext: requestContext("GET"),
    };
    await expect(handler(event as never, {} as never, jest.fn())).resolves.toMatchObject({ statusCode: 200 });
  });

  it.each([
    ["a removed User", []],
    ["a User whose Email changed for the same ID", [{ userId: "user-1", email: "new@example.com" }]],
    ["a User whose ID changed for the same Email", [{ userId: "user-2", email: "user@example.com" }]],
  ])("revalidates the allowlist on every request and rejects %s", async (_name, currentAllowlist) => {
    const handler = createWithAuth({
      store: createInMemoryPersonalAlbumStore(),
      resolveAllowedUsers: () => currentAllowlist,
    })(async () => ok({ reached: true }));
    const response = (await handler(
      eventWith(createSessionCookie(user).split("; ")[0]!, "cookies") as never,
      {} as never,
      jest.fn(),
    )) as unknown as { statusCode: number; body?: string; cookies?: string[] };
    expect(response).toMatchObject({ statusCode: 401, body: JSON.stringify({ message: "Unauthorized" }) });
    expect(response.cookies?.[0]).toMatch(/Max-Age=0/);
  });

  it("surfaces a malformed allowlist resolver as a rejected promise rather than a false authorization", async () => {
    const handler = createWithAuth({
      store: createInMemoryPersonalAlbumStore(),
      resolveAllowedUsers: () => {
        throw new Error("Invalid USER_ALLOWLIST entry");
      },
    })(async () => ok({ reached: true }));
    await expect(
      handler(eventWith(createSessionCookie(user).split("; ")[0]!, "cookies") as never, {} as never, jest.fn()),
    ).rejects.toThrow("Invalid USER_ALLOWLIST entry");
  });
});
