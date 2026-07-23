import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadToS3Error, uploadToS3 } from "./uploadToS3.js";

class FakeXhr {
  static instances: FakeXhr[] = [];
  status = 0;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sentHeaders: Record<string, string> = {};
  opened: { method: string; url: string } | undefined;
  aborted = false;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.opened = { method, url };
  }

  setRequestHeader(name: string, value: string) {
    this.sentHeaders[name] = value;
  }

  send() {
    // Test drives completion explicitly via respond()/fail()/abort() below.
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
}

const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });
const immediateDelay = () => Promise.resolve();
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe("uploadToS3", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves on a 2xx response", async () => {
    const promise = uploadToS3({ file, uploadUrl: "https://s3.example/put", onProgress: () => {}, delay: immediateDelay });
    FakeXhr.instances[0]!.respond(200);
    await expect(promise).resolves.toBeUndefined();
  });

  it("retries a network-class failure up to 2 times with backoff, then succeeds", async () => {
    const delay = vi.fn(immediateDelay);
    const promise = uploadToS3({ file, uploadUrl: "https://s3.example/put", onProgress: () => {}, delay });

    await flush();
    FakeXhr.instances[0]!.onerror?.();
    await flush();
    FakeXhr.instances[1]!.onerror?.();
    await flush();
    FakeXhr.instances[2]!.respond(200);

    await expect(promise).resolves.toBeUndefined();
    expect(FakeXhr.instances).toHaveLength(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenNthCalledWith(1, 500);
    expect(delay).toHaveBeenNthCalledWith(2, 1000);
  });

  it("gives up after 2 retries (3 attempts total) of network-class failures", async () => {
    const promise = uploadToS3({ file, uploadUrl: "https://s3.example/put", onProgress: () => {}, delay: immediateDelay });

    await flush();
    FakeXhr.instances[0]!.onerror?.();
    await flush();
    FakeXhr.instances[1]!.onerror?.();
    await flush();
    FakeXhr.instances[2]!.onerror?.();

    await expect(promise).rejects.toMatchObject({ kind: "network" });
    expect(FakeXhr.instances).toHaveLength(3);
  });

  it("never retries an HTTP 4xx", async () => {
    const delay = vi.fn(immediateDelay);
    const promise = uploadToS3({ file, uploadUrl: "https://s3.example/put", onProgress: () => {}, delay });
    FakeXhr.instances[0]!.respond(400);

    await expect(promise).rejects.toBeInstanceOf(UploadToS3Error);
    await expect(promise).rejects.toMatchObject({ kind: "failed" });
    expect(FakeXhr.instances).toHaveLength(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("surfaces an expired presign (403) as a distinct, non-retried failure", async () => {
    const promise = uploadToS3({ file, uploadUrl: "https://s3.example/put", onProgress: () => {}, delay: immediateDelay });
    FakeXhr.instances[0]!.respond(403);

    await expect(promise).rejects.toMatchObject({
      kind: "expired",
      message: "Selection expired — add these again",
    });
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it("aborts the in-flight request when the signal aborts, and does not retry", async () => {
    const controller = new AbortController();
    const promise = uploadToS3({
      file,
      uploadUrl: "https://s3.example/put",
      onProgress: () => {},
      signal: controller.signal,
      delay: immediateDelay,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(FakeXhr.instances[0]!.aborted).toBe(true);
    expect(FakeXhr.instances).toHaveLength(1);
  });
});
