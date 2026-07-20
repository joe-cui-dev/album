import type {
  CreateUploadBatchRequest,
  CreateUploadBatchResponse,
  ArchivePhotoResponse,
  CreateTemporaryPhotoUrlResponse,
  GetPhotoDetailResponse,
  GetSessionResponse,
  GetUploadBatchStatusResponse,
  ListTimelinePhotosResponse,
  RequestSignInCodeRequest,
  RequestSignInCodeResponse,
  RetryProcessingResponse,
  VerifySignInCodeRequest,
  VerifySignInCodeResponse,
} from "@album/shared";
import { apiBaseUrl } from "./config.js";
import { sessionExpiredEvent } from "./sessionEvents.js";

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const contentType = response.headers.get("Content-Type") ?? "";

  if (response.status === 401) {
    window.dispatchEvent(new Event(sessionExpiredEvent));
    throw new Error("Your session has expired.");
  }

  if (!response.ok) {
    if (!contentType.includes("application/json")) {
      throw new Error(messageForNonJsonResponse(contentType));
    }

    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(body.message ?? "Request failed");
  }

  if (!contentType.includes("application/json")) {
    throw new Error(messageForNonJsonResponse(contentType));
  }

  return (await response.json()) as T;
};

const messageForNonJsonResponse = (contentType: string): string => {
  if (contentType.includes("text/html")) {
    return "API returned HTML instead of JSON. Set VITE_API_BASE_URL to the Phase 5 HTTP API URL before starting Vite.";
  }

  return "API returned a non-JSON response. Check VITE_API_BASE_URL.";
};

export const apiClient = {
  getSession: () => request<GetSessionResponse>("/session"),
  signOut: () => request<GetSessionResponse>("/session", { method: "DELETE" }),
  requestSignInCode: (body: RequestSignInCodeRequest) =>
    request<RequestSignInCodeResponse>("/session/sign-in-code", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  verifySignInCode: (body: VerifySignInCodeRequest) =>
    request<VerifySignInCodeResponse>("/session/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createUploadBatch: (body: CreateUploadBatchRequest) =>
    request<CreateUploadBatchResponse>("/upload-batches", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getUploadBatchStatus: (uploadBatchId: string) =>
    request<GetUploadBatchStatusResponse>(`/upload-batches/${uploadBatchId}`),
  listTimelinePhotos: (query: Record<string, string> = {}) => {
    const search = new URLSearchParams(query);
    const suffix = search.size ? `?${search.toString()}` : "";
    return request<ListTimelinePhotosResponse>(`/timeline${suffix}`);
  },
  getPhotoDetail: (photoId: string) =>
    request<GetPhotoDetailResponse>(`/photos/${photoId}`),
  archivePhoto: (photoId: string) =>
    request<ArchivePhotoResponse>(`/photos/${photoId}/archive`, {
      method: "POST",
    }),
  createDisplayAccessUrl: (photoId: string) =>
    request<CreateTemporaryPhotoUrlResponse>(
      `/photos/${photoId}/display-access`,
      { method: "POST" },
    ),
  createOriginalDownloadUrl: (photoId: string) =>
    request<CreateTemporaryPhotoUrlResponse>(
      `/photos/${photoId}/original-download`,
      { method: "POST" },
    ),
  retryProcessing: (photoId: string) =>
    request<RetryProcessingResponse>(`/photos/${photoId}/retry-processing`, {
      method: "POST",
    }),
};
