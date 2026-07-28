import type { Page, Request, Route } from "@playwright/test";
import type {
  AlbumNavigationResponse,
  AlbumNavigationYear,
  TrashMembershipResponse,
  FavouriteMembershipResponse,
  CreateTemporaryPhotoUrlResponse,
  CreateUploadBatchResponse,
  GetProcessingIssuesSummaryResponse,
  GetSessionResponse,
  GetUploadBatchStatusResponse,
  ListCollectionPhotosResponse,
  ListProcessingIssuesResponse,
  ProcessingIssue,
  RequestSignInCodeResponse,
  RetryProcessingResponse,
  TimelinePhoto,
  TimelineThumbnailAccessResponse,
  VerifySignInCodeResponse,
  ViewerBootstrapResponse,
} from "@album/shared";

/** Fake host for direct S3 PUT uploads; Playwright intercepts these separately from `apiBaseUrl`. */
export const uploadHost = "http://album-uploads.e2e.test";

/** Fake host: Playwright intercepts every request before it reaches the network, so this never needs to resolve. */
export const apiBaseUrl = "http://album-api.e2e.test";

/** A 1x1 transparent PNG, so thumbnail/display `<img>` elements decode without any real network image fetch. */
export const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const FAR_FUTURE_EXPIRY = "2099-01-01T00:00:00.000Z";

export const defaultSession = (): GetSessionResponse => ({
  signedIn: true,
  user: { userId: "user-1", email: "joe@example.com" },
});

export const signedOutSession = (): GetSessionResponse => ({ signedIn: false });

export const requestSignInCodeAccepted = (
  overrides: Partial<RequestSignInCodeResponse> = {},
): RequestSignInCodeResponse => ({ accepted: true, ...overrides });

export const verifySignInCodeAccepted = (
  overrides: Partial<VerifySignInCodeResponse> = {},
): VerifySignInCodeResponse => ({
  signedIn: true,
  user: { userId: "user-1", email: "joe@example.com" },
  ...overrides,
});

export const emptyNavigation = (): AlbumNavigationResponse => ({
  timeline: { years: [] },
  trash: { years: [] },
  processingIssueCount: 0,
});

export const navigationWithYears = (
  overrides: Partial<{ timelineYears: AlbumNavigationYear[]; trashYears: AlbumNavigationYear[] }>,
): AlbumNavigationResponse => ({
  timeline: { years: overrides.timelineYears ?? [] },
  trash: { years: overrides.trashYears ?? [] },
  processingIssueCount: 0,
});

export const emptyCollectionPage = (): ListCollectionPhotosResponse => ({ photos: [] });

let photoCounter = 0;
/** Resets the auto-incrementing photo id/file name counter between tests. */
export const resetPhotoCounter = (): void => {
  photoCounter = 0;
};

export const buildPhoto = (overrides: Partial<TimelinePhoto> = {}): TimelinePhoto => {
  photoCounter += 1;
  const photoId = overrides.photoId ?? `photo-${photoCounter}`;
  return {
    photoId,
    fileName: overrides.fileName ?? `${photoId}.jpg`,
    capturedAt: overrides.capturedAt ?? { precision: "day", localDate: "2025-01-02" },
    addedAt: overrides.addedAt ?? "2025-01-02T10:00:00.000Z",
    displayDimensions: overrides.displayDimensions ?? { width: 1600, height: 1200 },
    timelineThumbnailSources: overrides.timelineThumbnailSources ?? {
      large: { url: TRANSPARENT_PIXEL, dimensions: { width: 640, height: 480 } },
    },
    favourite: overrides.favourite ?? false,
  };
};

export const collectionPage = (
  photos: TimelinePhoto[],
  overrides: Partial<ListCollectionPhotosResponse> = {},
): ListCollectionPhotosResponse => ({
  photos,
  expiresAt: FAR_FUTURE_EXPIRY,
  ...overrides,
});

export const buildViewerBootstrap = (
  overrides: Partial<ViewerBootstrapResponse> & { photoId: string; fileName: string },
): ViewerBootstrapResponse => ({
  format: "jpeg",
  fileSizeBytes: 1234,
  metadata: {},
  displayDimensions: { width: 1600, height: 1200 },
  chronology: {
    original: { capturedAt: { precision: "day", localDate: "2025-01-02" }, source: "exif" },
    active: { capturedAt: { precision: "day", localDate: "2025-01-02" }, source: "exif", revision: 1 },
  },
  trashed: false,
  favourite: false,
  collection: "active",
  displayAccess: { url: TRANSPARENT_PIXEL, expiresAt: FAR_FUTURE_EXPIRY },
  ...overrides,
});

export const thumbnailAccessResponse = (
  photoIds: string[],
  overrides: Partial<TimelineThumbnailAccessResponse> = {},
): TimelineThumbnailAccessResponse => ({
  photos: photoIds.map((photoId) => ({
    photoId,
    timelineThumbnailSources: { large: { url: TRANSPARENT_PIXEL, dimensions: { width: 640, height: 480 } } },
  })),
  expiresAt: FAR_FUTURE_EXPIRY,
  ...overrides,
});

const photoIdFromTrashPath = (url: string): string => {
  const match = /\/photos\/([^/]+)\/(?:trash|favourite|original-download|retry-processing)$/.exec(new URL(url).pathname);
  return match?.[1] ?? "unknown";
};

let processingIssueCounter = 0;
/** Resets the auto-incrementing Processing Issue counter between tests. */
export const resetProcessingIssueCounter = (): void => {
  processingIssueCounter = 0;
};

export const buildProcessingIssue = (overrides: Partial<ProcessingIssue> = {}): ProcessingIssue => {
  processingIssueCounter += 1;
  const photoId = overrides.photoId ?? `photo-issue-${processingIssueCounter}`;
  return {
    photoId,
    fileName: overrides.fileName ?? `${photoId}.jpg`,
    reasonCode: overrides.reasonCode ?? "finalProcessingFailure",
    status: overrides.status ?? "failed",
    addedAt: overrides.addedAt ?? "2025-01-02T10:00:00.000Z",
    firstOpenedAt: overrides.firstOpenedAt ?? "2025-01-02T10:00:00.000Z",
    attemptCount: overrides.attemptCount ?? 0,
    lastAttemptAt: overrides.lastAttemptAt ?? "2025-01-02T10:00:00.000Z",
  };
};

export const processingIssuesPage = (
  issues: ProcessingIssue[],
  overrides: Partial<ListProcessingIssuesResponse> = {},
): ListProcessingIssuesResponse => ({ issues, ...overrides });

let uploadPhotoCounter = 0;
/** Resets the auto-incrementing Upload Tray photo-id counter between tests. */
export const resetUploadPhotoCounter = (): void => {
  uploadPhotoCounter = 0;
};

/** Builds one `CreateUploadBatchResponse` upload entry per requested file, each PUT-able at `uploadHost`. */
export const createUploadBatchResponse = (
  fileCount: number,
  overrides: Partial<CreateUploadBatchResponse> = {},
): CreateUploadBatchResponse => ({
  uploadBatchId: overrides.uploadBatchId ?? "batch-1",
  uploads:
    overrides.uploads ??
    Array.from({ length: fileCount }, () => {
      uploadPhotoCounter += 1;
      const photoId = `photo-upload-${uploadPhotoCounter}`;
      return {
        photoId,
        objectKey: `originals/user-1/batch-1/${photoId}`,
        uploadUrl: `${uploadHost}/${photoId}`,
        duplicate: false,
      };
    }),
});

export const uploadBatchStatus = (
  uploadBatchId: string,
  photos: GetUploadBatchStatusResponse["photos"],
): GetUploadBatchStatusResponse => {
  const counts: GetUploadBatchStatusResponse["counts"] = {
    uploadRequested: 0,
    processing: 0,
    ready: 0,
    processingFailed: 0,
    exactDuplicate: 0,
  };
  for (const photo of photos) {
    counts[photo.processingState] += 1;
  }
  return { uploadBatchId, counts, photos };
};

type Responder = (route: Route, request: Request) => Promise<void> | void;

export const respondJson = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export const respondNoContent = (route: Route): Promise<void> => route.fulfill({ status: 204, body: "" });

export const respondAlbumError = (
  route: Route,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> => respondJson(route, { code, message, ...extra }, status);

export const respondUnauthorized = (route: Route): Promise<void> =>
  respondJson(route, { code: "auth_lost", message: "Session expired" }, 401);

/**
 * Stable machine-readable 412 for a stale `If-Match` on the captured-at adjustment/revert
 * routes (execution plan Slice 2.2: "Add a stable `chronology_changed` transport code for
 * 412 rather than reading its message"). Not yet consumed by the Web client -- the Chronology
 * editor lands in Slice 2 -- but scripted here now per Slice 0.3's failure-matrix scaffolding.
 */
export const respondChronologyConflict = (route: Route): Promise<void> =>
  respondAlbumError(route, 412, "chronology_changed", "Captured At changed since it was loaded");

/** Delays fulfilling `route` by `ms`, for scripting slow/pending states (Slice 0.3). */
export const respondAfterDelay = (route: Route, ms: number, body: unknown, status = 200): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(respondJson(route, body, status));
    }, ms);
  });

/** One endpoint's queued one-shot responders, falling back to a default once the queue is empty. */
class EndpointQueue {
  private readonly queue: Responder[] = [];
  private default: Responder;

  constructor(defaultResponder: Responder) {
    this.default = defaultResponder;
  }

  /** Serves this response exactly once, then reverts to the default (or the next queued response). */
  queueOnce(responder: Responder): this {
    this.queue.push(responder);
    return this;
  }

  setDefault(responder: Responder): this {
    this.default = responder;
    return this;
  }

  async handle(route: Route, request: Request): Promise<void> {
    const responder = this.queue.shift() ?? this.default;
    await responder(route, request);
  }
}

/**
 * Installs one `page.route` handler covering every Personal Album HTTP
 * contract endpoint the tracer's Web client calls, dispatching by pathname
 * and method to a per-endpoint queue. Each queue defaults to an empty/benign
 * response so tests only need to `queueOnce` the responses relevant to them.
 */
export class AlbumApiMock {
  readonly session = new EndpointQueue((route) => respondJson(route, defaultSession()));
  readonly signOut = new EndpointQueue((route) => respondJson(route, {}));
  readonly requestSignInCode = new EndpointQueue((route) => respondJson(route, requestSignInCodeAccepted()));
  readonly verifySignInCode = new EndpointQueue((route) => respondJson(route, verifySignInCodeAccepted()));
  readonly navigation = new EndpointQueue((route) => respondJson(route, emptyNavigation()));
  readonly timeline = new EndpointQueue((route) => respondJson(route, emptyCollectionPage()));
  readonly trash = new EndpointQueue((route) => respondJson(route, emptyCollectionPage()));
  readonly thumbnailAccess = new EndpointQueue((route) =>
    respondJson(route, { photos: [], expiresAt: FAR_FUTURE_EXPIRY } satisfies TimelineThumbnailAccessResponse),
  );
  readonly viewer = new EndpointQueue((route) =>
    respondAlbumError(route, 404, "not_found", "No viewer bootstrap mock queued for this Photo ID"),
  );
  readonly trashMembership = new EndpointQueue((route, request) =>
    respondJson(route, { photoId: photoIdFromTrashPath(request.url()), trashed: true } satisfies TrashMembershipResponse),
  );
  readonly restoreMembership = new EndpointQueue((route, request) =>
    respondJson(route, { photoId: photoIdFromTrashPath(request.url()), trashed: false } satisfies TrashMembershipResponse),
  );
  readonly favouriteMembership = new EndpointQueue((route, request) =>
    respondJson(route, { photoId: photoIdFromTrashPath(request.url()), favourite: true } satisfies FavouriteMembershipResponse),
  );
  readonly unfavouriteMembership = new EndpointQueue((route, request) =>
    respondJson(route, { photoId: photoIdFromTrashPath(request.url()), favourite: false } satisfies FavouriteMembershipResponse),
  );
  readonly permanentDeletion = new EndpointQueue((route) => respondNoContent(route));
  readonly emptyTrash = new EndpointQueue((route) => respondNoContent(route));
  readonly originalDownload = new EndpointQueue((route) =>
    respondJson(route, { url: TRANSPARENT_PIXEL, expiresInSeconds: 300 } satisfies CreateTemporaryPhotoUrlResponse),
  );
  readonly processingIssues = new EndpointQueue((route) =>
    respondJson(route, processingIssuesPage([])),
  );
  readonly processingIssuesSummary = new EndpointQueue((route) =>
    respondJson(route, { openCount: 0 } satisfies GetProcessingIssuesSummaryResponse),
  );
  readonly retryProcessing = new EndpointQueue((route) =>
    respondJson(route, { accepted: true, retryAttemptId: "retry-1" } satisfies RetryProcessingResponse),
  );
  /**
   * PUT (adjust)/DELETE (revert) `/photos/{photoId}/captured-at-adjustment` (execution plan
   * Slice 0.3). Not yet called by the Web client -- the Chronology editor lands in Slice 2 --
   * so the default 404s until a test queues a response, matching `viewer`'s pattern above.
   */
  readonly capturedAtAdjustment = new EndpointQueue((route) =>
    respondAlbumError(route, 404, "not_found", "No captured-at adjustment mock queued for this Photo ID"),
  );
  readonly createUploadBatch = new EndpointQueue((route, request) => {
    const body = request.postDataJSON() as { files: unknown[] };
    return respondJson(route, createUploadBatchResponse(body.files.length));
  });
  readonly uploadBatchStatus = new EndpointQueue((route) =>
    respondJson(route, uploadBatchStatus("batch-1", [])),
  );
  /** Every direct-to-S3 PUT the Tray issues; defaults to a bare 200 like a real presigned PUT response. */
  readonly s3Upload = new EndpointQueue((route) => route.fulfill({ status: 200, body: "" }));

  readonly requests: Request[] = [];

  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
    await this.page.route(`${uploadHost}/**`, async (route) => {
      this.requests.push(route.request());
      return this.s3Upload.handle(route, route.request());
    });

    await this.page.route(`${apiBaseUrl}/**`, async (route) => {
      const request = route.request();
      this.requests.push(request);
      const url = new URL(request.url());
      const method = request.method();

      if (url.pathname === "/session" && method === "GET") {
        return this.session.handle(route, request);
      }
      if (url.pathname === "/session" && method === "DELETE") {
        return this.signOut.handle(route, request);
      }
      if (url.pathname === "/session/sign-in-code" && method === "POST") {
        return this.requestSignInCode.handle(route, request);
      }
      if (url.pathname === "/session/verify" && method === "POST") {
        return this.verifySignInCode.handle(route, request);
      }
      if (url.pathname === "/album-navigation" && method === "GET") {
        return this.navigation.handle(route, request);
      }
      if (url.pathname === "/timeline" && method === "GET") {
        return this.timeline.handle(route, request);
      }
      if (url.pathname === "/trash" && method === "GET") {
        return this.trash.handle(route, request);
      }
      if (url.pathname === "/trash" && method === "DELETE") {
        return this.emptyTrash.handle(route, request);
      }
      if (url.pathname === "/timeline-thumbnail-access" && method === "POST") {
        return this.thumbnailAccess.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/viewer$/.test(url.pathname) && method === "GET") {
        return this.viewer.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/trash$/.test(url.pathname) && method === "PUT") {
        return this.trashMembership.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/trash$/.test(url.pathname) && method === "DELETE") {
        return this.restoreMembership.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/favourite$/.test(url.pathname) && method === "PUT") {
        return this.favouriteMembership.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/favourite$/.test(url.pathname) && method === "DELETE") {
        return this.unfavouriteMembership.handle(route, request);
      }
      if (/^\/photos\/[^/]+$/.test(url.pathname) && method === "DELETE") {
        return this.permanentDeletion.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/original-download$/.test(url.pathname) && method === "POST") {
        return this.originalDownload.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/retry-processing$/.test(url.pathname) && method === "POST") {
        return this.retryProcessing.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/captured-at-adjustment$/.test(url.pathname) && (method === "PUT" || method === "DELETE")) {
        return this.capturedAtAdjustment.handle(route, request);
      }
      if (url.pathname === "/processing-issues/summary" && method === "GET") {
        return this.processingIssuesSummary.handle(route, request);
      }
      if (url.pathname === "/processing-issues" && method === "GET") {
        return this.processingIssues.handle(route, request);
      }
      if (url.pathname === "/upload-batches" && method === "POST") {
        return this.createUploadBatch.handle(route, request);
      }
      if (/^\/upload-batches\/[^/]+$/.test(url.pathname) && method === "GET") {
        return this.uploadBatchStatus.handle(route, request);
      }

      await respondAlbumError(route, 404, "not_found", `Unmocked ${method} ${url.pathname}`);
    });
  }
}
