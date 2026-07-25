import { createInMemorySignInChallengeStore } from "../store/in-memory-sign-in-challenge-store.js";
import { hashSignInCode } from "../sign-in-code-crypto.js";
import { handleRequestSignInCode, handleVerifySignInCode, handler } from "./sign-in.js";

describe("handleRequestSignInCode", () => {
  it("enqueues a dispatch message for an Allowed Email and always reports accepted", async () => {
    const enqueued: Array<{ requestId: string; email: string }> = [];
    const response = await handleRequestSignInCode({
      body: JSON.stringify({ email: "USER@EXAMPLE.COM" }),
      deps: {
        newRequestId: () => "request-1",
        enqueueDispatch: async (message) => {
          enqueued.push(message);
        },
      },
    });
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ accepted: true }) });
    expect(enqueued).toEqual([{ requestId: "request-1", email: "user@example.com" }]);
  });

  it("enqueues the exact same way for a non-allowlisted Email -- no membership branch at admission", async () => {
    const enqueued: Array<{ requestId: string; email: string }> = [];
    const response = await handleRequestSignInCode({
      body: JSON.stringify({ email: "stranger@example.com" }),
      deps: { newRequestId: () => "request-1", enqueueDispatch: async (message) => { enqueued.push(message); } },
    });
    expect(response.body).toBe(JSON.stringify({ accepted: true }));
    expect(enqueued).toEqual([{ requestId: "request-1", email: "stranger@example.com" }]);
  });

  it("rejects a missing email", async () => {
    const response = await handleRequestSignInCode({
      body: JSON.stringify({}),
      deps: { newRequestId: () => "request-1", enqueueDispatch: async () => {} },
    });
    expect(response).toMatchObject({ statusCode: 400, body: JSON.stringify({ message: "Email is required" }) });
  });
});

describe("handleVerifySignInCode", () => {
  it("signs in on a correct code, consuming it so it can't be reused", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    await signInChallenges.tryDispatch({
      email: "user@example.com",
      requestId: "request-1",
      codeHash: hashSignInCode("123456"),
      now: new Date("2026-07-19T00:00:00.000Z"),
      codeTtlSeconds: 600,
    });
    const deps = { signInChallenges, now: () => new Date("2026-07-19T00:01:00.000Z") };

    const response = await handleVerifySignInCode({
      body: JSON.stringify({ email: "USER@EXAMPLE.COM", code: "123456" }),
      deps,
    });
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ signedIn: true, user: { userId: "user-1", email: "user@example.com" } }) });
    expect(response.cookies?.[0]).toMatch(/^album_session=/);

    const replay = await handleVerifySignInCode({ body: JSON.stringify({ email: "user@example.com", code: "123456" }), deps });
    expect(replay).toMatchObject({ statusCode: 403, body: JSON.stringify({ code: "sign_in_invalid", message: "Invalid or expired sign-in code" }) });
  });

  it.each([
    ["no code was ever dispatched", async (_store: ReturnType<typeof createInMemorySignInChallengeStore>) => {}],
    [
      "the code is wrong",
      async (store: ReturnType<typeof createInMemorySignInChallengeStore>) =>
        store.tryDispatch({ email: "user@example.com", requestId: "r", codeHash: hashSignInCode("999999"), now: new Date("2026-07-19T00:00:00.000Z"), codeTtlSeconds: 600 }),
    ],
    [
      "the code expired",
      async (store: ReturnType<typeof createInMemorySignInChallengeStore>) =>
        store.tryDispatch({ email: "user@example.com", requestId: "r", codeHash: hashSignInCode("123456"), now: new Date("2026-07-19T00:00:00.000Z"), codeTtlSeconds: -1 }),
    ],
  ])("rejects identically to a bad-request-shaped 403 when %s", async (_name, setup) => {
    const signInChallenges = createInMemorySignInChallengeStore();
    await setup(signInChallenges);
    const response = await handleVerifySignInCode({
      body: JSON.stringify({ email: "user@example.com", code: "123456" }),
      deps: { signInChallenges, now: () => new Date("2026-07-19T00:01:00.000Z") },
    });
    expect(response).toMatchObject({ statusCode: 403, body: JSON.stringify({ code: "sign_in_invalid", message: "Invalid or expired sign-in code" }) });
  });

  it("rejects a non-allowlisted Email identically -- no active Challenge can exist for it", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const response = await handleVerifySignInCode({
      body: JSON.stringify({ email: "stranger@example.com", code: "123456" }),
      deps: { signInChallenges, now: () => new Date() },
    });
    expect(response).toMatchObject({ statusCode: 403, body: JSON.stringify({ code: "sign_in_invalid", message: "Invalid or expired sign-in code" }) });
  });

  it("rejects a missing email or code", async () => {
    const signInChallenges = createInMemorySignInChallengeStore();
    const response = await handleVerifySignInCode({
      body: JSON.stringify({ email: "user@example.com" }),
      deps: { signInChallenges, now: () => new Date() },
    });
    expect(response).toMatchObject({ statusCode: 400, body: JSON.stringify({ message: "Email and code are required" }) });
  });
});

describe("sign-in handler", () => {
  // Only the Origin guard is exercised through the real exported `handler`: both routeKeys'
  // real deps reach live SQS/DynamoDB, which unit tests must not call. Routing and business
  // logic are fully covered above via handleRequestSignInCode/handleVerifySignInCode.
  it.each(["POST /session/sign-in-code", "POST /session/verify"])(
    "rejects a disallowed Origin for %s before any real dependency runs",
    async (routeKey) => {
      const response = await handler(
        {
          routeKey,
          headers: { origin: "https://evil.example.com" },
          requestContext: { http: { method: "POST" } },
          body: "{}",
        } as never,
        {} as never,
        jest.fn(),
      );
      expect(response).toMatchObject({ statusCode: 403, body: JSON.stringify({ code: "origin_rejected", message: "Forbidden" }) });
    },
  );
});
