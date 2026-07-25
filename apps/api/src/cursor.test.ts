import { decodeTimelineCursor, encodeTimelineCursor } from "./cursor.js";

describe("cursor codec", () => {
  it("round-trips through encode/decode for the matching collection", () => {
    const encoded = encodeTimelineCursor({ collection: "active", after: "TIMELINE#ACTIVE#2024.06.15.--.--.--.------#2026-07-19T00:00:00.000Z#photo-1" });
    expect(decodeTimelineCursor(encoded, "active")).toEqual({
      v: 1,
      collection: "active",
      after: "TIMELINE#ACTIVE#2024.06.15.--.--.--.------#2026-07-19T00:00:00.000Z#photo-1",
    });
  });

  it("is opaque (not human-decodable without decoding)", () => {
    const encoded = encodeTimelineCursor({ collection: "active", after: "TIMELINE#ACTIVE#x" });
    expect(encoded).not.toContain("TIMELINE");
  });

  it("rejects a cursor scoped to a different collection", () => {
    const encoded = encodeTimelineCursor({ collection: "active", after: "TIMELINE#ACTIVE#x" });
    expect(decodeTimelineCursor(encoded, "archived")).toBeUndefined();
  });

  it("rejects garbage input", () => {
    expect(decodeTimelineCursor("not-base64!!!", "active")).toBeUndefined();
    expect(decodeTimelineCursor(Buffer.from("null").toString("base64url"), "active")).toBeUndefined();
    expect(decodeTimelineCursor(Buffer.from(JSON.stringify({ v: 2, collection: "active", after: "x" })).toString("base64url"), "active")).toBeUndefined();
  });
});
