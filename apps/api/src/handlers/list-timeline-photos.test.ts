import { handleListTimelinePhotos } from "./list-timeline-photos.js";

describe("handleListTimelinePhotos", () => {
  it("returns the signed-in user's newest ready timeline photos and hides archived photos by default", async () => {
    const response = await handleListTimelinePhotos({
      user: { userId: "user-1", email: "user@example.com" },
      query: {},
      deps: {
        queryTimeline: async ({ userId }) => {
          expect(userId).toBe("user-1");
          return [
            { photoId: "photo-old", capturedAt: "2024-12-31T23:00:00.000Z" },
            { photoId: "photo-new", capturedAt: "2025-01-02T10:00:00.000Z" },
            { photoId: "photo-archived", capturedAt: "2025-01-03T10:00:00.000Z" },
            { photoId: "photo-processing", capturedAt: "2025-01-04T10:00:00.000Z" },
          ];
        },
        getPhoto: async ({ photoId }) => {
          const photos = {
            "photo-old": {
              photoId,
              fileName: "old.jpg",
              capturedAt: "2024-12-31T23:00:00.000Z",
              processingState: "ready",
              archived: false,
            },
            "photo-new": {
              photoId,
              fileName: "new.jpg",
              capturedAt: "2025-01-02T10:00:00.000Z",
              processingState: "ready",
              archived: false,
              displayObjectKey: "display/user-1/photo-new.jpg",
              displayDimensions: { width: 1600, height: 1200 },
            },
            "photo-archived": {
              photoId,
              fileName: "archived.jpg",
              capturedAt: "2025-01-03T10:00:00.000Z",
              processingState: "ready",
              archived: true,
            },
            "photo-processing": {
              photoId,
              fileName: "processing.jpg",
              capturedAt: "2025-01-04T10:00:00.000Z",
              processingState: "processing",
              archived: false,
            },
          } as const;
          return photos[photoId as keyof typeof photos];
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      photos: [
        {
          photoId: "photo-new",
          fileName: "new.jpg",
          capturedAt: "2025-01-02T10:00:00.000Z",
          processingState: "ready",
          archived: false,
          displayObjectKey: "display/user-1/photo-new.jpg",
          displayDimensions: { width: 1600, height: 1200 },
        },
        {
          photoId: "photo-old",
          fileName: "old.jpg",
          capturedAt: "2024-12-31T23:00:00.000Z",
          processingState: "ready",
          archived: false,
        },
      ],
    });
  });

  it("applies year, month, processing state, and archived filters", async () => {
    const response = await handleListTimelinePhotos({
      user: { userId: "user-1", email: "user@example.com" },
      query: {
        year: "2025",
        month: "02",
        processingState: "processingFailed",
        archived: "true",
      },
      deps: {
        queryTimeline: async ({ fromCapturedAt, toCapturedAt }) => {
          expect(fromCapturedAt).toBe("2025-02-01T00:00:00.000Z");
          expect(toCapturedAt).toBe("2025-03-01T00:00:00.000Z");
          return [
            { photoId: "photo-1", capturedAt: "2025-02-10T10:00:00.000Z" },
            { photoId: "photo-2", capturedAt: "2025-02-11T10:00:00.000Z" },
          ];
        },
        getPhoto: async ({ photoId }) => ({
          photoId,
          fileName: `${photoId}.jpg`,
          capturedAt: "2025-02-10T10:00:00.000Z",
          processingState:
            photoId === "photo-1" ? "processingFailed" : "ready",
          archived: photoId === "photo-1",
        }),
      },
    });

    expect(JSON.parse(response.body ?? "{}")).toEqual({
      photos: [
        {
          photoId: "photo-1",
          fileName: "photo-1.jpg",
          capturedAt: "2025-02-10T10:00:00.000Z",
          processingState: "processingFailed",
          archived: true,
        },
      ],
    });
  });
});
