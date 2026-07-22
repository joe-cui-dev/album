import { act, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowsingHistoryRegistry } from "../browsing/browsingHistoryRegistry.js";
import { renderApp } from "../../test/test-utils.js";
import { createUploadTray, type UploadTray } from "./uploadTray.js";
import { createTestUploadTrayPort, type TestUploadTrayPort } from "./testUploadTrayPort.js";
import { UploadTrayPanel } from "./UploadTrayPanel.js";

vi.mock("./hashFile.js", () => ({ hashFile: vi.fn(async () => "hash-value") }));

const fakeRegistry = (): BrowsingHistoryRegistry => ({
  activate: vi.fn(),
  applyMembershipChange: vi.fn(),
  revertMembershipChange: vi.fn(),
  notifyPhotosArrived: vi.fn(),
  applyChronologyChange: vi.fn(),
  disposeAll: vi.fn(),
});

const photoFile = (name: string): File => new File(["data"], name, { type: "image/jpeg" });

describe("UploadTrayPanel", () => {
  let port: TestUploadTrayPort;
  let tray: UploadTray;

  beforeEach(() => {
    port = createTestUploadTrayPort();
    tray = createUploadTray({
      port: port.port,
      registry: fakeRegistry(),
      userId: "user-1",
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    document.body.innerHTML = '<button id="album-add-photos-button">Add photos</button>';
  });

  afterEach(() => {
    tray.dispose();
    document.body.innerHTML = "";
  });

  it("is a non-modal named dialog with no aria-modal attribute", async () => {
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.open());

    const dialog = await screen.findByRole("dialog", { name: "Add photos" });
    expect(dialog).not.toHaveAttribute("aria-modal");
  });

  it("focuses the heading on open", async () => {
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.open());

    await waitFor(() => expect(screen.getByRole("heading", { name: "Add photos" })).toHaveFocus());
  });

  it("focuses the persistent progress button on minimise, and the heading again on restore", async () => {
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.open());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add photos" })).toHaveFocus());

    act(() => tray.intents.minimize());
    await waitFor(() => expect(screen.getByRole("button", { name: "Show upload progress" })).toHaveFocus());

    act(() => tray.intents.open());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add photos" })).toHaveFocus());
  });

  it("focuses the global Add photos button on dismiss", async () => {
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.open());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add photos" })).toHaveFocus());

    act(() => tray.intents.dismiss());
    await waitFor(() => expect(document.getElementById("album-add-photos-button")).toHaveFocus());
  });

  it("Escape dismisses a pristine Tray", async () => {
    const user = userEvent.setup();
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.open());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add photos" })).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(tray.getSnapshot().visible).toBe(false);
  });

  it("Escape minimises a Tray with active work instead of dismissing it", async () => {
    const user = userEvent.setup();
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.addFiles([photoFile("a.jpg")]));
    act(() => tray.intents.startUpload());
    await waitFor(() => expect(port.createUploadBatchCalls.length).toBe(1));
    act(() =>
      port.resolveNextCreateUploadBatch({
        uploadBatchId: "batch-1",
        uploads: [{ photoId: "photo-1", objectKey: "originals/user-1/batch-1/photo-1", uploadUrl: "https://upload.example/1", duplicate: false }],
      }),
    );
    await waitFor(() => expect(tray.getSnapshot().uploadBatchId).toBeDefined());

    await user.keyboard("{Escape}");

    expect(tray.getSnapshot().visible).toBe(true);
    expect(tray.getSnapshot().minimized).toBe(true);
  });

  it("announces a batch-level milestone once, without replaying it across minimise/restore", async () => {
    renderApp(<UploadTrayPanel tray={tray} />);
    act(() => tray.intents.addFiles([photoFile("a.jpg")]));
    act(() => tray.intents.startUpload());
    await waitFor(() => expect(port.createUploadBatchCalls.length).toBe(1));
    act(() =>
      port.resolveNextCreateUploadBatch({
        uploadBatchId: "batch-1",
        uploads: [{ photoId: "photo-1", objectKey: "originals/user-1/batch-1/photo-1", uploadUrl: "https://upload.example/1", duplicate: false }],
      }),
    );

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 photo"));

    act(() => tray.intents.minimize());
    act(() => tray.intents.open());

    // Still the same announcement text -- restoring did not clear or re-set it.
    expect(screen.getByRole("status")).toHaveTextContent("Uploading 1 photo");
  });
});
