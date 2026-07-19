import { createHash } from "node:crypto";
import { createInMemorySignInCodeStore } from "../store/in-memory-sign-in-code-store.js";

const originalSesFromEmail = process.env.SES_FROM_EMAIL;
const originalAllowDevAuthCodes = process.env.ALLOW_DEV_AUTH_CODES;

afterEach(() => {
  if (originalSesFromEmail === undefined) delete process.env.SES_FROM_EMAIL;
  else process.env.SES_FROM_EMAIL = originalSesFromEmail;
  if (originalAllowDevAuthCodes === undefined) delete process.env.ALLOW_DEV_AUTH_CODES;
  else process.env.ALLOW_DEV_AUTH_CODES = originalAllowDevAuthCodes;
  jest.resetModules();
});

const loadSession = async ({
  sesFromEmail,
  allowDevAuthCodes,
}: {
  sesFromEmail?: string;
  allowDevAuthCodes?: boolean;
} = {}) => {
  if (sesFromEmail === undefined) delete process.env.SES_FROM_EMAIL;
  else process.env.SES_FROM_EMAIL = sesFromEmail;
  if (allowDevAuthCodes === undefined) delete process.env.ALLOW_DEV_AUTH_CODES;
  else process.env.ALLOW_DEV_AUTH_CODES = String(allowDevAuthCodes);
  jest.resetModules();
  return import("./session.js");
};

describe("handleRequestSignInCode", () => {
  it("stores only a hash for an Allowed User and sends their sign-in code", async () => {
    const { handleRequestSignInCode } = await loadSession({ sesFromEmail: "album@example.com" });
    const signInCodes = createInMemorySignInCodeStore();
    const sent: unknown[] = [];
    const response = await handleRequestSignInCode({
      body: JSON.stringify({ email: "USER@EXAMPLE.COM" }),
      deps: {
        signInCodes,
        now: () => new Date("2026-07-19T00:00:00.000Z"),
        generateCode: () => "123456",
        newCodeId: () => "code-1",
        sendSignInCodeEmail: async (input) => {
          sent.push(input);
        },
      },
    });

    expect(response).toMatchObject({
      statusCode: 200,
      body: JSON.stringify({ accepted: true, codeId: "code-1" }),
    });
    await expect(
      signInCodes.getSignInCode({ email: "user@example.com", codeId: "code-1" }),
    ).resolves.toEqual({
      email: "user@example.com",
      codeId: "code-1",
      userId: "user-1",
      codeHash: createHash("sha256").update("test-secret:123456").digest("hex"),
      createdAt: "2026-07-19T00:00:00.000Z",
      expiresAt: 1_784_419_800,
    });
    expect(sent).toEqual([{ email: "user@example.com", code: "123456" }]);
  });

  it("accepts a non-allowlisted email without storing a code or sending mail", async () => {
    const { handleRequestSignInCode } = await loadSession({ sesFromEmail: "album@example.com" });
    const signInCodes = createInMemorySignInCodeStore();
    const sendSignInCodeEmail = jest.fn();
    const response = await handleRequestSignInCode({
      body: JSON.stringify({ email: "stranger@example.com" }),
      deps: { signInCodes, now: () => new Date(), generateCode: () => "123456", newCodeId: () => "code-1", sendSignInCodeEmail },
    });
    expect(response.body).toBe(JSON.stringify({ accepted: true }));
    expect(await signInCodes.getSignInCode({ email: "stranger@example.com", codeId: "code-1" })).toBeUndefined();
    expect(sendSignInCodeEmail).not.toHaveBeenCalled();
  });

  it("keeps the no-SES development branch and can expose a dev code", async () => {
    const { handleRequestSignInCode } = await loadSession({ allowDevAuthCodes: true });
    const signInCodes = createInMemorySignInCodeStore();
    const sendSignInCodeEmail = jest.fn();
    const response = await handleRequestSignInCode({
      body: JSON.stringify({ email: "user@example.com" }),
      deps: { signInCodes, now: () => new Date("2026-07-19T00:00:00.000Z"), generateCode: () => "123456", newCodeId: () => "code-1", sendSignInCodeEmail },
    });
    expect(response.body).toBe(JSON.stringify({ accepted: true, codeId: "code-1", devCode: "123456" }));
    expect(sendSignInCodeEmail).not.toHaveBeenCalled();
  });
});

describe("handleVerifySignInCode", () => {
  const verifyDeps = (signInCodes = createInMemorySignInCodeStore()) => ({
    signInCodes,
    now: () => new Date("2026-07-19T00:00:00.000Z"),
  });
  const validRecord = {
    email: "user@example.com", codeId: "code-1", userId: "user-1",
    codeHash: createHash("sha256").update("test-secret:123456").digest("hex"),
    createdAt: "2026-07-19T00:00:00.000Z", expiresAt: 1_784_419_800,
  };

  it("signs in with a correct code, creates a cookie, and deletes the one-time code", async () => {
    const { handleVerifySignInCode } = await loadSession();
    const deps = verifyDeps();
    await deps.signInCodes.createSignInCode(validRecord);
    const response = await handleVerifySignInCode({ body: JSON.stringify({ email: "USER@EXAMPLE.COM", codeId: "code-1", code: "123456" }), deps });
    expect(response).toMatchObject({ statusCode: 200, body: JSON.stringify({ signedIn: true, user: { userId: "user-1", email: "user@example.com" } }) });
    expect(response.cookies?.[0]).toMatch(/^album_session=/);
    await expect(deps.signInCodes.getSignInCode({ email: "user@example.com", codeId: "code-1" })).resolves.toBeUndefined();
  });

  it.each([
    ["wrong code", { ...validRecord, expiresAt: 1_784_419_800 }, "000000"],
    ["expired code", { ...validRecord, expiresAt: 1_784_419_199 }, "123456"],
    ["missing code", undefined, "123456"],
  ])("rejects a %s", async (_name, record, code) => {
    const { handleVerifySignInCode } = await loadSession();
    const deps = verifyDeps();
    if (record) await deps.signInCodes.createSignInCode(record);
    const response = await handleVerifySignInCode({ body: JSON.stringify({ email: "user@example.com", codeId: "code-1", code }), deps });
    expect(response).toMatchObject({ statusCode: 403, body: JSON.stringify({ message: "Invalid or expired sign-in code" }) });
  });

  it("rejects non-allowlisted users and malformed verification requests", async () => {
    const { handleVerifySignInCode } = await loadSession();
    const deps = verifyDeps();
    await expect(handleVerifySignInCode({ body: JSON.stringify({ email: "stranger@example.com", codeId: "code-1", code: "123456" }), deps })).resolves.toMatchObject({ statusCode: 403, body: JSON.stringify({ message: "Email is not allowlisted" }) });
    await expect(handleVerifySignInCode({ body: JSON.stringify({ email: "user@example.com" }), deps })).resolves.toMatchObject({ statusCode: 400, body: JSON.stringify({ message: "Email, codeId, and code are required" }) });
  });
});

describe("session handler", () => {
  it("keeps GET /session unauthenticated and DELETE /session clears the cookie", async () => {
    const { handler } = await loadSession();
    const { createSessionCookie } = await import("../auth.js");
    const signedIn = await handler({ routeKey: "GET /session", cookies: [createSessionCookie({ userId: "user-1", email: "user@example.com" })], headers: {} } as never, {} as never, jest.fn()) as unknown as { body?: string };
    const anonymous = await handler({ routeKey: "GET /session", headers: {} } as never, {} as never, jest.fn()) as unknown as { body?: string };
    const invalid = await handler({ routeKey: "GET /session", cookies: ["album_session=not-a-cookie"], headers: {} } as never, {} as never, jest.fn()) as unknown as { body?: string };
    const cleared = await handler({ routeKey: "DELETE /session", headers: {} } as never, {} as never, jest.fn()) as unknown as { statusCode: number; body?: string; cookies?: string[] };
    expect(signedIn.body).toBe(JSON.stringify({ signedIn: true, user: { userId: "user-1", email: "user@example.com" } }));
    expect(anonymous.body).toBe(JSON.stringify({ signedIn: false }));
    expect(invalid.body).toBe(JSON.stringify({ signedIn: false }));
    expect(cleared).toMatchObject({ statusCode: 200, body: JSON.stringify({ signedIn: false }), cookies: [expect.stringContaining("Max-Age=0")] });
  });
});
