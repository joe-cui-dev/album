import { deriveSignInCode, hashSignInCode, safeEqual } from "./sign-in-code-crypto.js";

describe("deriveSignInCode", () => {
  it("is deterministic for the same requestId (redelivery-stable)", () => {
    expect(deriveSignInCode("request-1")).toBe(deriveSignInCode("request-1"));
  });

  it("differs across requestIds", () => {
    expect(deriveSignInCode("request-1")).not.toBe(deriveSignInCode("request-2"));
  });

  it("is always a six-digit string", () => {
    for (const requestId of ["a", "b", "c", "d", "e", "request-1", "request-2", "12345"]) {
      const code = deriveSignInCode(requestId);
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashSignInCode", () => {
  it("is deterministic and does not reveal the raw code", () => {
    const hash = hashSignInCode("123456");
    expect(hash).toBe(hashSignInCode("123456"));
    expect(hash).not.toContain("123456");
  });

  it("differs across codes", () => {
    expect(hashSignInCode("123456")).not.toBe(hashSignInCode("654321"));
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal strings correctly regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
