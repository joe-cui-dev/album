const originalUserAllowlist = process.env.USER_ALLOWLIST;

afterEach(() => {
  process.env.USER_ALLOWLIST = originalUserAllowlist;
  jest.resetModules();
});

const loadSession = async ({
  userAllowlist,
}: {
  userAllowlist?: string;
} = {}) => {
  if (userAllowlist !== undefined) process.env.USER_ALLOWLIST = userAllowlist;
  jest.resetModules();
  return import("./session.js");
};

describe("session handler", () => {
  const getEvent = (extra: Record<string, unknown>) => ({
    routeKey: "GET /session",
    requestContext: { http: { method: "GET" } },
    headers: {},
    ...extra,
  });
  const mutationEvent = (routeKey: string, extra: Record<string, unknown> = {}) => ({
    routeKey,
    requestContext: { http: { method: routeKey.split(" ")[0] } },
    headers: { origin: "https://album.example.com" },
    ...extra,
  });

  it("keeps GET /session unauthenticated and DELETE /session clears the cookie", async () => {
    const { handler } = await loadSession();
    const { createSessionCookie } = await import("../auth.js");
    const signedIn = (await handler(getEvent({ cookies: [createSessionCookie({ userId: "user-1", email: "user@example.com" })] }) as never, {} as never, jest.fn())) as unknown as { body?: string };
    const anonymous = (await handler(getEvent({}) as never, {} as never, jest.fn())) as unknown as { body?: string };
    const invalid = (await handler(getEvent({ cookies: ["album_session=not-a-cookie"] }) as never, {} as never, jest.fn())) as unknown as { body?: string };
    const cleared = (await handler(mutationEvent("DELETE /session") as never, {} as never, jest.fn())) as unknown as { statusCode: number; body?: string; cookies?: string[] };
    expect(signedIn.body).toBe(JSON.stringify({ signedIn: true, user: { userId: "user-1", email: "user@example.com" } }));
    expect(anonymous.body).toBe(JSON.stringify({ signedIn: false }));
    expect(invalid.body).toBe(JSON.stringify({ signedIn: false }));
    expect(cleared).toMatchObject({ statusCode: 200, body: JSON.stringify({ signedIn: false }), cookies: [expect.stringContaining("Max-Age=0")] });
  });

  it("revalidates the allowlist on GET /session and clears the cookie for a removed User", async () => {
    const { handler } = await loadSession({ userAllowlist: "other-user:other@example.com" });
    const { createSessionCookie } = await import("../auth.js");
    const response = (await handler(
      getEvent({ cookies: [createSessionCookie({ userId: "user-1", email: "user@example.com" })] }) as never,
      {} as never,
      jest.fn(),
    )) as unknown as { body?: string; cookies?: string[] };
    expect(response.body).toBe(JSON.stringify({ signedIn: false }));
    expect(response.cookies?.[0]).toMatch(/Max-Age=0/);
  });

  it("rejects a mutation from a disallowed Origin before any other check", async () => {
    const { handler } = await loadSession();
    const response = await handler(
      mutationEvent("DELETE /session", { headers: { origin: "https://evil.example.com" } }) as never,
      {} as never,
      jest.fn(),
    );
    expect(response).toMatchObject({ statusCode: 403, body: JSON.stringify({ code: "origin_rejected", message: "Forbidden" }) });
  });
});
