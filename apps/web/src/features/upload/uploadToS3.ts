export type UploadToS3FailureKind = "network" | "expired" | "cancelled" | "failed";

export class UploadToS3Error extends Error {
  readonly kind: UploadToS3FailureKind;

  constructor(kind: UploadToS3FailureKind, message: string) {
    super(message);
    this.name = "UploadToS3Error";
    this.kind = kind;
  }
}

interface UploadToS3Input {
  file: File;
  uploadUrl: string;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}

/** 1 initial attempt plus 2 retries (implementation doc "Transfer"). */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000];

const putOnce = ({ file, uploadUrl, onProgress, signal }: UploadToS3Input): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    const onAbort = () => request.abort();
    signal?.addEventListener("abort", onAbort);
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      cleanup();
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      // S3 rejects an expired presigned URL with 403; every other status is a non-retryable failure.
      if (request.status === 403) {
        reject(new UploadToS3Error("expired", "Selection expired — add these again"));
        return;
      }
      reject(new UploadToS3Error("failed", "Upload failed"));
    };
    request.onerror = () => {
      cleanup();
      reject(new UploadToS3Error("network", "Upload failed"));
    };
    request.ontimeout = () => {
      cleanup();
      reject(new UploadToS3Error("network", "Upload failed"));
    };
    request.onabort = () => {
      cleanup();
      reject(new UploadToS3Error("cancelled", "Upload cancelled"));
    };

    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.send(file);
  });

/**
 * Retries network-class failures only (`onerror`, timeout) with exponential
 * backoff; an HTTP 4xx -- including an expired presign -- never retries
 * (implementation doc "Transfer"). `delay` is a test seam for the backoff wait.
 */
export const uploadToS3 = async (
  input: UploadToS3Input & { delay?: (ms: number) => Promise<void> },
): Promise<void> => {
  const delay = input.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await putOnce(input);
      return;
    } catch (error) {
      const retryable = error instanceof UploadToS3Error && error.kind === "network";
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }
      await delay(BACKOFF_MS[attempt] as number);
    }
  }
};
