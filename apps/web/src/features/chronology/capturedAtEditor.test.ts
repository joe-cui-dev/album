import { describe, expect, it, vi } from "vitest";
import type { ViewerBootstrapResponse } from "@album/shared";
import { AlbumTransportError } from "../../lib/albumTransport.js";
import { createCapturedAtEditor } from "./capturedAtEditor.js";
import type { CapturedAtEditorPort } from "./capturedAtEditorPort.js";

const chronology = {
  original: { capturedAt: { precision: "day" as const, localDate: "2024-06-15" }, source: "exif" as const },
  active: { capturedAt: { precision: "dateTime" as const, localDate: "2024-06-15", localTime: "08:30", timeResolution: "minute" as const }, source: "userAdjusted" as const, revision: 3 },
};

const latest = (revision = 4): ViewerBootstrapResponse => ({
  photoId: "photo-1", fileName: "beach.jpg", format: "jpeg", fileSizeBytes: 1,
  displayDimensions: { width: 1, height: 1 }, chronology: { ...chronology, active: { ...chronology.active, revision } },
  trashed: false, favourite: false, collection: "active", displayAccess: { url: "https://example.test/photo.jpg", expiresAt: "2099-01-01T00:00:00.000Z" },
});

const port = (overrides: Partial<CapturedAtEditorPort> = {}): CapturedAtEditorPort => ({
  adjust: vi.fn().mockResolvedValue({}),
  revert: vi.fn().mockResolvedValue({}),
  loadLatest: vi.fn().mockResolvedValue(latest()),
  ...overrides,
});

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("createCapturedAtEditor", () => {
  it("keeps partial chronology blank until the User provides a complete replacement", () => {
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology: { ...chronology, active: { ...chronology.active, capturedAt: { precision: "month", localDate: "2024-06" } } }, port: port(), onSuccess: vi.fn(), onDismiss: vi.fn() });
    expect(editor.getSnapshot().draft).toEqual({ date: "", time: "", timeIncludes: "minute", offset: "" });
  });

  it("validates the first required date field without sending a malformed replacement", async () => {
    const testPort = port();
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess: vi.fn(), onDismiss: vi.fn() });
    editor.intents.change("date", "");
    editor.intents.save();
    await flush();
    expect(editor.getSnapshot().errors.date).toBeDefined();
    expect(testPort.adjust).not.toHaveBeenCalled();
  });

  it("canonicalises fractional trailing zeroes and uses the active revision as If-Match input", async () => {
    const testPort = port();
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess: vi.fn(), onDismiss: vi.fn() });
    editor.intents.change("timeIncludes", "subsecond");
    editor.intents.change("time", "08:30:12.1200");
    editor.intents.save();
    await flush();
    expect(testPort.adjust).toHaveBeenCalledWith(expect.objectContaining({ revision: 3, capturedAt: expect.objectContaining({ localTime: "08:30:12.12" }) }));
  });

  it("keeps an explicit valid UTC offset and allows a dirty editor to resolve through Discard", async () => {
    const onDismiss = vi.fn();
    const testPort = port();
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess: vi.fn(), onDismiss });
    editor.intents.change("offset", "+10:00");
    editor.intents.save();
    await flush();
    expect(testPort.adjust).toHaveBeenCalledWith(expect.objectContaining({ capturedAt: expect.objectContaining({ offset: "+10:00" }) }));

    editor.intents.change("date", "2024-07-04");
    editor.intents.requestClose();
    expect(editor.getSnapshot().mode).toBe("discard");
    editor.intents.discard();
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("reverts with the active revision and reports the original source for an announcement", async () => {
    const onSuccess = vi.fn();
    const testPort = port();
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess, onDismiss: vi.fn() });
    editor.intents.beginRevert();
    editor.intents.confirmRevert();
    await flush();
    expect(testPort.revert).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ kind: "revert", source: "exif" }));
  });

  it("preserves the cohesive draft on a stale conflict and adopts only the newest revision when asked", async () => {
    const testPort = port({ adjust: vi.fn().mockRejectedValue(new AlbumTransportError("chronology_changed", "stale")) });
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess: vi.fn(), onDismiss: vi.fn() });
    editor.intents.change("date", "2024-07-04");
    editor.intents.save();
    await flush();
    await flush();
    expect(editor.getSnapshot().mode).toBe("conflict");
    editor.intents.keepMyChanges();
    expect(editor.getSnapshot().draft.date).toBe("2024-07-04");
    editor.intents.save();
    await flush();
    expect(testPort.adjust).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 4 }));
  });

  it("uses latest as a cohesive replacement rather than merging individual fields", async () => {
    const current = latest(5);
    current.chronology.active.capturedAt = { precision: "dateTime", localDate: "2025-01-02", localTime: "09:00:15", timeResolution: "second", offset: "+10:00" };
    const testPort = port({ adjust: vi.fn().mockRejectedValue(new AlbumTransportError("chronology_changed", "stale")), loadLatest: vi.fn().mockResolvedValue(current) });
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess: vi.fn(), onDismiss: vi.fn() });
    editor.intents.change("date", "2024-07-04");
    editor.intents.save();
    await flush(); await flush();
    editor.intents.useLatest();
    expect(editor.getSnapshot().draft).toEqual({ date: "2025-01-02", time: "09:00:15", timeIncludes: "second", offset: "+10:00" });
    expect(editor.getSnapshot().dirty).toBe(false);
  });

  it("keeps a failed save open with the draft available for Retry", async () => {
    const testPort = port({ adjust: vi.fn().mockRejectedValue(new AlbumTransportError("network", "offline")) });
    const editor = createCapturedAtEditor({ photoId: "photo-1", collection: "active", chronology, port: testPort, onSuccess: vi.fn(), onDismiss: vi.fn() });
    editor.intents.save();
    await flush();
    expect(editor.getSnapshot().networkError).toContain("Couldn’t save");
    expect(editor.getSnapshot().draft.time).toBe("08:30");
  });
});
