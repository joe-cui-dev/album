import { guardMutationOrigin, isAllowedOrigin } from "./origin.js";

const allowed = ["https://album.example.com", "https://dev.album.example.com"];

describe("isAllowedOrigin", () => {
  it("accepts an exact configured Origin", () => {
    expect(isAllowedOrigin("https://album.example.com", allowed)).toBe(true);
    expect(isAllowedOrigin("https://dev.album.example.com", allowed)).toBe(true);
  });

  it("rejects a missing Origin", () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });

  it("rejects the opaque 'null' Origin", () => {
    expect(isAllowedOrigin("null", allowed)).toBe(false);
  });

  it("rejects a malformed Origin", () => {
    expect(isAllowedOrigin("not-a-url", allowed)).toBe(false);
    expect(isAllowedOrigin("*", allowed)).toBe(false);
  });

  it("rejects a credential-bearing Origin", () => {
    expect(isAllowedOrigin("https://user:pass@album.example.com", allowed)).toBe(false);
  });

  it("rejects a path-bearing Origin", () => {
    expect(isAllowedOrigin("https://album.example.com/evil", allowed)).toBe(false);
  });

  it("rejects a suffix Origin", () => {
    expect(isAllowedOrigin("https://album.example.com.evil.com", allowed)).toBe(false);
  });

  it("rejects a substring Origin", () => {
    expect(isAllowedOrigin("https://evilalbum.example.com", allowed)).toBe(false);
  });

  it("rejects a wildcard Origin", () => {
    expect(isAllowedOrigin("*", allowed)).toBe(false);
  });

  it("rejects a scheme mismatch", () => {
    expect(isAllowedOrigin("http://album.example.com", allowed)).toBe(false);
  });
});

describe("guardMutationOrigin", () => {
  const eventWith = (method: string, origin: string | undefined) => ({
    headers: origin === undefined ? {} : { origin },
    requestContext: { http: { method } },
  });

  it("exempts GET and HEAD regardless of Origin", () => {
    expect(guardMutationOrigin(eventWith("GET", undefined), allowed)).toBeUndefined();
    expect(guardMutationOrigin(eventWith("HEAD", "https://evil.example.com"), allowed)).toBeUndefined();
  });

  it("passes a mutation with an allowed Origin", () => {
    expect(guardMutationOrigin(eventWith("POST", "https://album.example.com"), allowed)).toBeUndefined();
  });

  it("rejects a mutation with a missing or disallowed Origin", () => {
    expect(guardMutationOrigin(eventWith("POST", undefined), allowed)).toMatchObject({
      statusCode: 403,
      body: JSON.stringify({ code: "origin_rejected", message: "Forbidden" }),
    });
    expect(guardMutationOrigin(eventWith("PUT", "https://evil.example.com"), allowed)).toMatchObject({
      statusCode: 403,
    });
    expect(guardMutationOrigin(eventWith("DELETE", "https://evil.example.com"), allowed)).toMatchObject({
      statusCode: 403,
    });
    expect(guardMutationOrigin(eventWith("PATCH", "https://evil.example.com"), allowed)).toMatchObject({
      statusCode: 403,
    });
  });

  it("also checks a capitalized Origin header", () => {
    const event = { headers: { Origin: "https://evil.example.com" }, requestContext: { http: { method: "POST" } } };
    expect(guardMutationOrigin(event, allowed)).toMatchObject({ statusCode: 403 });
  });
});
