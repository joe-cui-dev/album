import { fireEvent, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { hashFile } from "./features/upload/hashFile.js";
import { sessionExpiredEvent } from "./lib/apiClient.js";
import { renderApp } from "./test/test-utils.js";

vi.mock("./features/upload/hashFile.js", () => ({
  hashFile: vi.fn(async () => "hash-value"),
}));

vi.mock("./features/upload/uploadToS3.js", () => ({
  uploadToS3: vi.fn(async ({ onProgress }) => {
    onProgress(100);
  }),
}));

const apiBaseUrl =
  "https://replace-with-http-api-id.execute-api.ap-southeast-2.amazonaws.com";

describe("App", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("shows the email sign-in form when no session is active", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ signedIn: false }),
    );

    renderApp(<App />);

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send sign-in code" }),
    ).toBeInTheDocument();
  });

  it("gives an empty signed-in album a single clear next action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);

    expect(await screen.findByRole("navigation", { name: "Album" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your album is empty" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("heading", { name: "Your album is empty" }).parentElement!)
        .getByRole("button", { name: "Add photos" }),
    ).toBeInTheDocument();
  });

  it("keeps Archive behind the signed-in application route", async () => {
    window.history.replaceState({}, "", "/album/archive");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);

    expect(
      await screen.findByRole("heading", { name: "Your archive is empty" }),
    ).toBeInTheDocument();
  });

  it("returns to sign-in when a protected request reports an expired session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);
    await screen.findByRole("navigation", { name: "Album" });

    fireEvent(window, new Event(sessionExpiredEvent));

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
  });

  it("shows an actionable error when the API responds with the Vite HTML fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<!doctype html><html></html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );

    renderApp(<App />);

    expect(
      await screen.findByText(
        "API returned HTML instead of JSON. Set VITE_API_BASE_URL to the Phase 5 HTTP API URL before starting Vite.",
      ),
    ).toBeInTheDocument();
  });

  it("requests a sign-in code on the same page and shows a development code hint", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ signedIn: false }))
      .mockResolvedValueOnce(
        Response.json({ accepted: true, codeId: "code-1", devCode: "123456" }),
      );

    renderApp(<App />);

    await userEvent.type(
      await screen.findByLabelText("Email address"),
      "joe@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
    expect(screen.getByText(/Development code:/)).toHaveTextContent("123456");
    expect(fetch).toHaveBeenLastCalledWith(
      `${apiBaseUrl}/session/sign-in-code`,
      {
        method: "POST",
        body: JSON.stringify({ email: "joe@example.com" }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      },
    );
  });

  it("signs out and returns to the email sign-in form", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ signedIn: false }));

    renderApp(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(`${apiBaseUrl}/session`, {
      method: "DELETE",
      credentials: "include",
      headers: {},
    });
  });

  it("keeps invalid selected files visible but creates an upload batch with valid files only", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          uploads: [
            {
              photoId: "photo-1",
              objectKey: "originals/user-1/batch-1/photo-1",
              uploadUrl: "https://upload.example/photo-1",
              duplicate: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          counts: {
            uploadRequested: 0,
            uploaded: 0,
            processing: 0,
            ready: 1,
            processingFailed: 0,
            exactDuplicate: 0,
          },
          photos: [
            {
              photoId: "photo-1",
              fileName: "valid.jpg",
              processingState: "ready",
              exactDuplicate: false,
            },
          ],
        }),
      );

    renderApp(<App />);

    const input = await screen.findByLabelText("Choose photos");
    const valid = new File(["valid"], "valid.jpg", { type: "image/jpeg" });
    const invalid = new File(["invalid"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [valid, invalid] } });

    expect(await screen.findByText("valid.jpg")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("JPEG, PNG, or HEIC photos only")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));

    expect(fetch).toHaveBeenNthCalledWith(2, `${apiBaseUrl}/upload-batches`, {
      method: "POST",
      body: JSON.stringify({
        files: [
          {
            fileName: "valid.jpg",
            contentType: "image/jpeg",
            fileSizeBytes: valid.size,
            clientSha256: "hash-value",
            fileModifiedAt: new Date(valid.lastModified).toISOString(),
          },
        ],
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("blocks upload batches with more than 100 valid files before calling the API", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        signedIn: true,
        user: { userId: "user-1", email: "joe@example.com" },
      }),
    );

    renderApp(<App />);

    const input = await screen.findByLabelText("Choose photos");
    const files = Array.from(
      { length: 101 },
      (_, index) =>
        new File(["valid"], `valid-${index}.jpg`, { type: "image/jpeg" }),
    );
    fireEvent.change(input, { target: { files } });

    expect(await screen.findByText("Choose 100 photos or fewer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 101 photos" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("warns when browser hashing fails but still creates the upload batch without clientSha256", async () => {
    vi.mocked(hashFile).mockRejectedValueOnce(new Error("hash unavailable"));
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          uploads: [
            {
              photoId: "photo-1",
              objectKey: "originals/user-1/batch-1/photo-1",
              uploadUrl: "https://upload.example/photo-1",
              duplicate: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          counts: {
            uploadRequested: 0,
            uploaded: 0,
            processing: 0,
            ready: 1,
            processingFailed: 0,
            exactDuplicate: 0,
          },
          photos: [
            {
              photoId: "photo-1",
              fileName: "valid.jpg",
              processingState: "ready",
              exactDuplicate: false,
            },
          ],
        }),
      );

    renderApp(<App />);

    const input = await screen.findByLabelText("Choose photos");
    const valid = new File(["valid"], "valid.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [valid] } });
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));

    expect(
      await screen.findByText("Could not calculate SHA-256 for one or more files."),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(2, `${apiBaseUrl}/upload-batches`, {
      method: "POST",
      body: JSON.stringify({
        files: [
          {
            fileName: "valid.jpg",
            contentType: "image/jpeg",
            fileSizeBytes: valid.size,
            fileModifiedAt: new Date(valid.lastModified).toISOString(),
          },
        ],
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("polls upload batch status every 2 seconds and stops after terminal states", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          uploads: [
            {
              photoId: "photo-1",
              objectKey: "originals/user-1/batch-1/photo-1",
              uploadUrl: "https://upload.example/photo-1",
              duplicate: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          counts: {
            uploadRequested: 0,
            uploaded: 0,
            processing: 1,
            ready: 0,
            processingFailed: 0,
            exactDuplicate: 0,
          },
          photos: [
            {
              photoId: "photo-1",
              fileName: "valid.jpg",
              processingState: "processing",
              exactDuplicate: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          counts: {
            uploadRequested: 0,
            uploaded: 0,
            processing: 0,
            ready: 1,
            processingFailed: 0,
            exactDuplicate: 0,
          },
          photos: [
            {
              photoId: "photo-1",
              fileName: "valid.jpg",
              processingState: "ready",
              exactDuplicate: false,
            },
          ],
        }),
      );

    renderApp(<App />);

    const input = await screen.findByLabelText("Choose photos");
    fireEvent.change(input, {
      target: { files: [new File(["valid"], "valid.jpg", { type: "image/jpeg" })] },
    });
    await user.click(screen.getByRole("button", { name: "Upload 1 photo" }));

    expect(await screen.findByText("Processing state: Processing")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText("Processing state: Ready")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("shows duplicate and failed processing results and retries failed photos without optimistic state changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          uploads: [
            {
              photoId: "photo-1",
              objectKey: "originals/user-1/batch-1/photo-1",
              uploadUrl: "https://upload.example/photo-1",
              duplicate: false,
            },
            {
              photoId: "photo-2",
              objectKey: "originals/user-1/batch-1/photo-2",
              uploadUrl: "https://upload.example/photo-2",
              duplicate: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          counts: {
            uploadRequested: 0,
            uploaded: 0,
            processing: 0,
            ready: 0,
            processingFailed: 1,
            exactDuplicate: 1,
          },
          photos: [
            {
              photoId: "photo-1",
              fileName: "failed.jpg",
              processingState: "processingFailed",
              exactDuplicate: false,
              failureMessage: "Decoder could not read the photo",
            },
            {
              photoId: "photo-2",
              fileName: "duplicate.jpg",
              processingState: "exactDuplicate",
              exactDuplicate: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          photoId: "photo-1",
          fileName: "failed.jpg",
          processingState: "processingFailed",
          exactDuplicate: false,
          failureMessage: "Decoder could not read the photo",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          uploadBatchId: "batch-1",
          counts: {
            uploadRequested: 0,
            uploaded: 0,
            processing: 1,
            ready: 0,
            processingFailed: 0,
            exactDuplicate: 1,
          },
          photos: [
            {
              photoId: "photo-1",
              fileName: "failed.jpg",
              processingState: "processing",
              exactDuplicate: false,
            },
            {
              photoId: "photo-2",
              fileName: "duplicate.jpg",
              processingState: "exactDuplicate",
              exactDuplicate: true,
            },
          ],
        }),
      );

    renderApp(<App />);

    const input = await screen.findByLabelText("Choose photos");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["failed"], "failed.jpg", { type: "image/jpeg" }),
          new File(["duplicate"], "duplicate.jpg", { type: "image/jpeg" }),
        ],
      },
    });
    await user.click(screen.getByRole("button", { name: "Upload 2 photos" }));

    expect(await screen.findByText("Decoder could not read the photo")).toBeInTheDocument();
    expect(screen.getAllByText("Exact duplicate").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Retry failed.jpg" }));
    expect(screen.getByText("Processing state: Processing failed")).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      `${apiBaseUrl}/photos/photo-1/retry-processing`,
      {
        method: "POST",
        credentials: "include",
        headers: {},
      },
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText("Processing state: Processing")).toBeInTheDocument();
  });

  it("browses timeline photos, opens detail, archives, and creates a single-photo original download", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          signedIn: true,
          user: { userId: "user-1", email: "joe@example.com" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          photos: [
            {
              photoId: "photo-1",
              fileName: "beach.jpg",
              capturedAt: "2025-01-02T10:00:00.000Z",
              processingState: "ready",
              archived: false,
              displayDimensions: { width: 1600, height: 1200 },
              timelineThumbnailUrl: "https://temporary.example/thumbnail.jpg",
              timelineThumbnailDimensions: { width: 320, height: 240 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          photoId: "photo-1",
          fileName: "beach.jpg",
          format: "jpeg",
          fileSizeBytes: 1234,
          capturedAt: "2025-01-02T10:00:00.000Z",
          capturedAtSource: "exif",
          processingState: "ready",
          archived: false,
          metadata: {
            width: 4000,
            height: 3000,
            cameraMake: "Canon",
          },
          displayDimensions: { width: 1600, height: 1200 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          url: "https://temporary.example/display.jpg",
          expiresInSeconds: 300,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          url: "https://temporary.example/original.jpg",
          expiresInSeconds: 300,
        }),
      )
      .mockResolvedValueOnce(Response.json({ photoId: "photo-1", archived: true }))
      .mockResolvedValueOnce(Response.json({ photos: [] }));

    renderApp(<App />);

    fireEvent.change(await screen.findByLabelText("Choose photos"), {
      target: { files: [new File(["draft"], "draft.jpg", { type: "image/jpeg" })] },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Refresh timeline" }));
    expect(await screen.findByAltText("beach.jpg thumbnail")).toHaveAttribute(
      "src",
      "https://temporary.example/thumbnail.jpg",
    );
    await userEvent.click(await screen.findByRole("button", { name: "Open beach.jpg" }));

    expect(await screen.findByText("Canon")).toBeInTheDocument();
    expect(screen.getByAltText("beach.jpg")).toHaveAttribute(
      "src",
      "https://temporary.example/display.jpg",
    );

    await userEvent.click(screen.getByRole("button", { name: "Download original" }));
    expect(await screen.findByRole("link", { name: "Open original download" })).toHaveAttribute(
      "href",
      "https://temporary.example/original.jpg",
    );

    await userEvent.click(screen.getByRole("button", { name: "Archive photo" }));
    expect(await screen.findByText("No timeline photos")).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(2, `${apiBaseUrl}/timeline`, {
      credentials: "include",
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(4, `${apiBaseUrl}/photos/photo-1/display-access`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(5, `${apiBaseUrl}/photos/photo-1/original-download`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(6, `${apiBaseUrl}/photos/photo-1/archive`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });
  });
});
