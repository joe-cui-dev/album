const originalAllowlist = process.env.USER_ALLOWLIST;

afterEach(() => {
  process.env.USER_ALLOWLIST = originalAllowlist;
  jest.resetModules();
});

describe("User Allowlist", () => {
  it("parses Allowed Users and normalizes Email Addresses", async () => {
    process.env.USER_ALLOWLIST = "user-1:User@Example.com, user_2: second@example.com ";
    jest.resetModules();
    const { findAllowedUserByEmail, getAllowedUsers, normalizeEmail } = await import("./allowlist.js");
    expect(normalizeEmail(" User@Example.COM ")).toBe("user@example.com");
    expect(getAllowedUsers()).toEqual([
      { userId: "user-1", email: "user@example.com" },
      { userId: "user_2", email: "second@example.com" },
    ]);
    expect(findAllowedUserByEmail(" SECOND@EXAMPLE.COM ")).toEqual({ userId: "user_2", email: "second@example.com" });
  });

  it("keeps malformed allowlist entries as errors", async () => {
    process.env.USER_ALLOWLIST = "bad-entry";
    jest.resetModules();
    const { getAllowedUsers } = await import("./allowlist.js");
    expect(() => getAllowedUsers()).toThrow("Invalid USER_ALLOWLIST entry");
  });
});
