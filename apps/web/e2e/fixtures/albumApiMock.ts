import type { Page, Request, Route } from "@playwright/test";
import type {
  AlbumNavigationResponse,
  AlbumNavigationYear,
  ArchiveMembershipResponse,
  CreateTemporaryPhotoUrlResponse,
  GetProcessingIssuesSummaryResponse,
  GetSessionResponse,
  ListCollectionPhotosV2Response,
  ListProcessingIssuesResponse,
  ProcessingIssue,
  RetryProcessingResponse,
  TimelinePhotoV2,
  TimelineThumbnailAccessResponse,
  ViewerBootstrapResponse,
} from "@album/shared";

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

export const emptyNavigation = (): AlbumNavigationResponse => ({
  timeline: { years: [] },
  archive: { years: [] },
  processingIssueCount: 0,
});

export const navigationWithYears = (
  overrides: Partial<{ timelineYears: AlbumNavigationYear[]; archiveYears: AlbumNavigationYear[] }>,
): AlbumNavigationResponse => ({
  timeline: { years: overrides.timelineYears ?? [] },
  archive: { years: overrides.archiveYears ?? [] },
  processingIssueCount: 0,
});

export const emptyCollectionPage = (): ListCollectionPhotosV2Response => ({ photos: [] });

let photoCounter = 0;
/** Resets the auto-incrementing photo id/file name counter between tests. */
export const resetPhotoCounter = (): void => {
  photoCounter = 0;
};

export const buildPhoto = (overrides: Partial<TimelinePhotoV2> = {}): TimelinePhotoV2 => {
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
  };
};

export const collectionPage = (
  photos: TimelinePhotoV2[],
  overrides: Partial<ListCollectionPhotosV2Response> = {},
): ListCollectionPhotosV2Response => ({
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
  archived: false,
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

const photoIdFromArchivePath = (url: string): string => {
  const match = /\/photos\/([^/]+)\/(?:archive|original-download|retry-processing)$/.exec(new URL(url).pathname);
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

type Responder = (route: Route, request: Request) => Promise<void> | void;

export const respondJson = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export const respondAlbumError = (
  route: Route,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> => respondJson(route, { code, message, ...extra }, status);

export const respondUnauthorized = (route: Route): Promise<void> =>
  respondJson(route, { code: "auth_lost", message: "Session expired" }, 401);

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
  readonly navigation = new EndpointQueue((route) => respondJson(route, emptyNavigation()));
  readonly timeline = new EndpointQueue((route) => respondJson(route, emptyCollectionPage()));
  readonly archive = new EndpointQueue((route) => respondJson(route, emptyCollectionPage()));
  readonly thumbnailAccess = new EndpointQueue((route) =>
    respondJson(route, { photos: [], expiresAt: FAR_FUTURE_EXPIRY } satisfies TimelineThumbnailAccessResponse),
  );
  readonly viewer = new EndpointQueue((route) =>
    respondAlbumError(route, 404, "not_found", "No viewer bootstrap mock queued for this Photo ID"),
  );
  readonly archiveMembership = new EndpointQueue((route, request) =>
    respondJson(route, { photoId: photoIdFromArchivePath(request.url()), archived: true } satisfies ArchiveMembershipResponse),
  );
  readonly restoreMembership = new EndpointQueue((route, request) =>
    respondJson(route, { photoId: photoIdFromArchivePath(request.url()), archived: false } satisfies ArchiveMembershipResponse),
  );
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

  readonly requests: Request[] = [];

  constructor(private readonly page: Page) {}

  async install(): Promise<void> {
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
      if (url.pathname === "/album-navigation" && method === "GET") {
        return this.navigation.handle(route, request);
      }
      if (url.pathname === "/v2/timeline" && method === "GET") {
        return this.timeline.handle(route, request);
      }
      if (url.pathname === "/v2/archive" && method === "GET") {
        return this.archive.handle(route, request);
      }
      if (url.pathname === "/timeline-thumbnail-access" && method === "POST") {
        return this.thumbnailAccess.handle(route, request);
      }
      if (/^\/v2\/photos\/[^/]+\/viewer$/.test(url.pathname) && method === "GET") {
        return this.viewer.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/archive$/.test(url.pathname) && method === "PUT") {
        return this.archiveMembership.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/archive$/.test(url.pathname) && method === "DELETE") {
        return this.restoreMembership.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/original-download$/.test(url.pathname) && method === "POST") {
        return this.originalDownload.handle(route, request);
      }
      if (/^\/photos\/[^/]+\/retry-processing$/.test(url.pathname) && method === "POST") {
        return this.retryProcessing.handle(route, request);
      }
      if (url.pathname === "/processing-issues/summary" && method === "GET") {
        return this.processingIssuesSummary.handle(route, request);
      }
      if (url.pathname === "/processing-issues" && method === "GET") {
        return this.processingIssues.handle(route, request);
      }

      await respondAlbumError(route, 404, "not_found", `Unmocked ${method} ${url.pathname}`);
    });
  }
}
