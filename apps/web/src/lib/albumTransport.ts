import type { AlbumErrorCode, PhotoCollection } from "@album/shared";
import { apiBaseUrl } from "./config.js";
import { sessionExpiredEvent } from "./sessionEvents.js";

/** Client-only codes, plus every stable server code from `AlbumErrorCode` (ADR-0066). */
export type AlbumTransportErrorCode =
  | AlbumErrorCode
  | "cancelled"
  | "network"
  | "non_json"
  | "auth_lost"
  | "image_failed"
  | "unexpected";

export class AlbumTransportError extends Error {
  readonly code: AlbumTransportErrorCode;
  readonly status?: number;
  /** Present only for `photo_collection_changed`. */
  readonly currentCollection?: PhotoCollection;

  constructor(
    code: AlbumTransportErrorCode,
    message: string,
    options?: { status?: number; currentCollection?: PhotoCollection; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AlbumTransportError";
    this.code = code;
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.currentCollection !== undefined) {
      this.currentCollection = options.currentCollection;
    }
  }
}

/** Owned adapters raise this for a failed or rejected image, keeping the taxonomy uniform across transport and image loads. */
export const imageAccessError = (message = "Image failed to load"): AlbumTransportError =>
  new AlbumTransportError("image_failed", message);

export interface AlbumTransportRequestInit {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * One `AbortSignal`-aware, typed-error JSON transport. Owned Browsing Window
 * and Photo Viewer ports call this and translate its responses into their
 * own module interfaces; React elements never call it directly and never
 * parse raw headers or infrastructure messages (ADR-0066).
 */
export const albumTransport = {
  request: async <T>(path: string, init: AlbumTransportRequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        method: init.method ?? "GET",
        credentials: "include",
        signal: init.signal ?? null,
        headers: {
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AlbumTransportError("cancelled", "Request was cancelled", { cause: error });
      }
      throw new AlbumTransportError("network", "Network request failed", { cause: error });
    }

    if (response.status === 401) {
      window.dispatchEvent(new Event(sessionExpiredEvent));
      throw new AlbumTransportError("auth_lost", "Your session has expired", { status: 401 });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new AlbumTransportError("non_json", messageForNonJsonResponse(contentType), {
        status: response.status,
      });
    }

    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const parsed = isRecord(body) ? body : {};
      const code = isAlbumErrorCode(parsed.code) ? parsed.code : "unexpected";
      throw new AlbumTransportError(code, typeof parsed.message === "string" ? parsed.message : "Request failed", {
        status: response.status,
        ...(code === "photo_collection_changed" && isPhotoCollection(parsed.currentCollection)
          ? { currentCollection: parsed.currentCollection }
          : {}),
      });
    }

    return body as T;
  },
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

const albumErrorCodes = new Set<AlbumErrorCode>([
  "empty_period",
  "photo_collection_changed",
  "chronology_changed",
  "concurrent_projection_movement",
]);
const isAlbumErrorCode = (value: unknown): value is AlbumErrorCode =>
  typeof value === "string" && albumErrorCodes.has(value as AlbumErrorCode);

const isPhotoCollection = (value: unknown): value is PhotoCollection =>
  value === "active" || value === "trashed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const messageForNonJsonResponse = (contentType: string): string => {
  if (contentType.includes("text/html")) {
    return "API returned HTML instead of JSON. Set VITE_API_BASE_URL to the Phase 5 HTTP API URL before starting Vite.";
  }
  return "API returned a non-JSON response. Check VITE_API_BASE_URL.";
};
