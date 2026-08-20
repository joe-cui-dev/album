import { describe, expect, it } from "vitest";
import { daysRemainingInTrash, isRetentionUrgent, retentionBadgeLabel } from "./trashRetention.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-08-21T00:00:00.000Z");

describe("daysRemainingInTrash", () => {
  it("computes the ceiling of the whole days left in the 30-day Retention Window", () => {
    const deletedAt = new Date(now - 25 * DAY_MS).toISOString();
    expect(daysRemainingInTrash(deletedAt, now)).toBe(5);
  });

  it("rounds a partial day up, not down", () => {
    const deletedAt = new Date(now - (25 * DAY_MS + 1)).toISOString();
    expect(daysRemainingInTrash(deletedAt, now)).toBe(5);
  });

  it("goes to zero on the exact deletion moment", () => {
    const deletedAt = new Date(now - 30 * DAY_MS).toISOString();
    expect(daysRemainingInTrash(deletedAt, now)).toBe(0);
  });

  it("can go negative on a stale page, rather than clamping", () => {
    const deletedAt = new Date(now - 33 * DAY_MS).toISOString();
    expect(daysRemainingInTrash(deletedAt, now)).toBe(-3);
  });
});

describe("retentionBadgeLabel", () => {
  it("shows the day count for two or more days", () => {
    expect(retentionBadgeLabel(5)).toBe("5 days left");
    expect(retentionBadgeLabel(2)).toBe("2 days left");
  });

  it("shows Last day for exactly one day", () => {
    expect(retentionBadgeLabel(1)).toBe("Last day");
  });

  it("shows Deleting soon for zero or negative, never a negative number", () => {
    expect(retentionBadgeLabel(0)).toBe("Deleting soon");
    expect(retentionBadgeLabel(-4)).toBe("Deleting soon");
  });
});

describe("isRetentionUrgent", () => {
  it("is urgent at 3 days or fewer", () => {
    expect(isRetentionUrgent(3)).toBe(true);
    expect(isRetentionUrgent(1)).toBe(true);
    expect(isRetentionUrgent(0)).toBe(true);
  });

  it("is not urgent above 3 days", () => {
    expect(isRetentionUrgent(4)).toBe(false);
    expect(isRetentionUrgent(10)).toBe(false);
  });
});
