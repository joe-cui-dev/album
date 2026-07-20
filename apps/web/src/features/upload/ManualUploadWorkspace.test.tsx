import { fireEvent, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualUploadWorkspace } from "./ManualUploadWorkspace.js";
import { hashFile } from "./hashFile.js";
import { renderApp } from "../../test/test-utils.js";

vi.mock("./hashFile.js", () => ({
  hashFile: vi.fn(async () => "hash-value"),
}));

vi.mock("./uploadToS3.js", () => ({
  uploadToS3: vi.fn(async ({ onProgress }) => {
    onProgress(100);
  }),
}));

const apiBaseUrl =
  "https://replace-with-http-api-id.execute-api.ap-southeast-2.amazonaws.com";

describe("ManualUploadWorkspace", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps invalid selected files visible but creates an upload batch with valid files only", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
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

    renderApp(<ManualUploadWorkspace />);

    const input = await screen.findByLabelText("Choose photos");
    const valid = new File(["valid"], "valid.jpg", { type: "image/jpeg" });
    const invalid = new File(["invalid"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [valid, invalid] } });

    expect(await screen.findByText("valid.jpg")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("JPEG, PNG, or HEIC photos only")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));

    expect(fetch).toHaveBeenNthCalledWith(1, `${apiBaseUrl}/upload-batches`, {
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
        uploadContext: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
  });

  it("blocks upload batches with more than 100 valid files before calling the API", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    renderApp(<ManualUploadWorkspace />);

    const input = await screen.findByLabelText("Choose photos");
    const files = Array.from(
      { length: 101 },
      (_, index) => new File(["valid"], `valid-${index}.jpg`, { type: "image/jpeg" }),
    );
    fireEvent.change(input, { target: { files } });

    expect(await screen.findByText("Choose 100 photos or fewer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 101 photos" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("warns when browser hashing fails but still creates the upload batch without clientSha256", async () => {
    vi.mocked(hashFile).mockRejectedValueOnce(new Error("hash unavailable"));
    const fetch = vi
      .spyOn(globalThis, "fetch")
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

    renderApp(<ManualUploadWorkspace />);

    const input = await screen.findByLabelText("Choose photos");
    const valid = new File(["valid"], "valid.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [valid] } });
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 photo" }));

    expect(
      await screen.findByText("Could not calculate SHA-256 for one or more files."),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenNthCalledWith(1, `${apiBaseUrl}/upload-batches`, {
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
        uploadContext: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
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

    renderApp(<ManualUploadWorkspace />);

    const input = await screen.findByLabelText("Choose photos");
    fireEvent.change(input, {
      target: { files: [new File(["valid"], "valid.jpg", { type: "image/jpeg" })] },
    });
    await user.click(screen.getByRole("button", { name: "Upload 1 photo" }));

    expect(await screen.findByText("Processing state: Processing")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText("Processing state: Ready")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("shows duplicate and failed processing results and retries failed photos without optimistic state changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetch = vi
      .spyOn(globalThis, "fetch")
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

    renderApp(<ManualUploadWorkspace />);

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
    expect(fetch).toHaveBeenNthCalledWith(3, `${apiBaseUrl}/photos/photo-1/retry-processing`, {
      method: "POST",
      credentials: "include",
      headers: {},
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText("Processing state: Processing")).toBeInTheDocument();
  });
});
