import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../fixtures/test.js";
import { buildPhoto, collectionPage, emptyCollectionPage, emptyNavigation, respondJson } from "../fixtures/albumApiMock.js";

const PHOTO_COUNT = 20_000;
const PAGE_SIZE = 100;
const MAX_HEAP_GROWTH_BYTES = 75 * 1024 * 1024;
const MAX_MOUNTED_PHOTO_NODES = 250;
const MAX_RENEWAL_BATCH = 100;
const MAX_RELAYOUT_P95_MS = 100;
const MAX_LONG_TASK_MS = 50;

type PerformanceResult = {
  environment: { platform: string; release: string; arch: string; browser: string };
  heapGrowthBytes: number;
  mountedPhotoNodes: number;
  maxCursorConcurrency: number;
  maxRenewalBatchSize: number;
  relayoutSamplesMs: number[];
  relayoutP95Ms: number;
  longTaskDurationsMs: number[];
  longestApplicationTaskMs: number;
  geometryStable: boolean;
};

test.setTimeout(180_000);

test("measures the 20,000-Photo Timeline candidate profile", async ({ browserName, mock, page }, testInfo) => {
  test.skip(browserName !== "chromium", "the numeric profile is pinned to Chromium");
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // Empty signed-in Timeline is the heap baseline required by the design, not an unsigned
  // blank page. The next load replaces this response with the generated 20,000-Photo album.
  mock.timeline.setDefault((route) => respondJson(route, emptyCollectionPage()));
  mock.navigation.setDefault((route) => respondJson(route, emptyNavigation()));
  await page.goto("/album");
  await expect(page.getByRole("heading", { name: "Your album is empty" })).toBeVisible();
  await client.send("HeapProfiler.collectGarbage");
  const baseline = await client.send("Runtime.getHeapUsage") as { usedSize: number };

  const photos = Array.from({ length: PHOTO_COUNT }, (_, index) => {
    // Responses are ordered exactly like a real Timeline: contiguous calendar periods,
    // with partial-date groups represented among them. Alternating months per descriptor
    // would measure an impossible server ordering and turn every Photo into a marker.
    const periodIndex = Math.floor(index / PAGE_SIZE);
    const year = 2025 - Math.floor(periodIndex / 12);
    const month = String(12 - (periodIndex % 12)).padStart(2, "0");
    const day = String((index % 28) + 1).padStart(2, "0");
    const ratio = index % 19 === 0 ? { width: 4000, height: 500 } : index % 7 === 0 ? { width: 600, height: 1600 } : { width: 1600, height: 1200 };
    const capturedAt = periodIndex % 13 === 0
      ? { precision: "year" as const, localDate: `${year}` }
      : periodIndex % 11 === 0
        ? { precision: "month" as const, localDate: `${year}-${month}` }
        : { precision: "day" as const, localDate: `${year}-${month}-${day}` };
    return buildPhoto({
      photoId: `scale-${index}`,
      fileName: `Long synthetic Original Photo file name ${String(index).padStart(5, "0")} — 你好 مرحبا.jpg`,
      capturedAt,
      displayDimensions: ratio,
    });
  });
  let activeCursorReads = 0;
  let maxCursorConcurrency = 0;
  mock.timeline.setDefault(async (route, request) => {
    activeCursorReads += 1;
    maxCursorConcurrency = Math.max(maxCursorConcurrency, activeCursorReads);
    try {
      const start = Number(new URL(request.url()).searchParams.get("cursor") ?? "0");
      const next = start + PAGE_SIZE;
      await new Promise((resolve) => setTimeout(resolve, 1));
      await respondJson(route, collectionPage(photos.slice(start, next), {
        ...(next < PHOTO_COUNT ? { nextCursor: String(next) } : {}),
        // Expired synthetic grants exercise and measure the 100-Photo renewal boundary.
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }));
    } finally {
      activeCursorReads -= 1;
    }
  });

  await page.reload();
  await expect(page.getByRole("link").first()).toBeVisible();
  // Initial descriptor ingestion is intentionally excluded: the gate measures application
  // long tasks introduced by continuous scripted scrolling, as specified in the design.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const durations: number[] = [];
    new PerformanceObserver((entries) => durations.push(...entries.getEntries().map((entry) => entry.duration))).observe({ type: "longtask", buffered: true });
    (window as Window & { __albumLongTasks?: number[] }).__albumLongTasks = durations;
  });

  const relayoutSamplesMs: number[] = [];
  let geometryStable = true;
  for (let iteration = 0; iteration < 240; iteration += 1) {
    const before = await page.locator('a[href*="/photos/"]').evaluateAll((links) =>
      links.slice(0, 8).map((link) => ({ href: (link as HTMLAnchorElement).href, rect: link.getBoundingClientRect().toJSON() })),
    );
    const startedAt = performance.now();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(20);
    relayoutSamplesMs.push(performance.now() - startedAt);
    const after = await page.locator('a[href*="/photos/"]').evaluateAll((links) =>
      links.slice(0, 8).map((link) => ({ href: (link as HTMLAnchorElement).href, rect: link.getBoundingClientRect().toJSON() })),
    );
    const beforeByHref = new Map(before.map((item) => [item.href, item.rect]));
    geometryStable &&= after.every((item) => {
      const previous = beforeByHref.get(item.href);
      return !previous || (previous.width === item.rect.width && previous.height === item.rect.height);
    });
    const requests = mock.requests.filter((request) => new URL(request.url()).pathname === "/timeline");
    if (requests.length >= PHOTO_COUNT / PAGE_SIZE) break;
  }

  await expect.poll(() => mock.requests.filter((request) => new URL(request.url()).pathname === "/timeline").length).toBe(PHOTO_COUNT / PAGE_SIZE);
  await client.send("HeapProfiler.collectGarbage");
  const finalHeap = await client.send("Runtime.getHeapUsage") as { usedSize: number };
  const mountedPhotoNodes = await page.locator('a[href*="/photos/"], a[href*="/photos/"] img').count();
  const renewalBatchSizes = mock.requests
    .filter((request) => new URL(request.url()).pathname === "/timeline-thumbnail-access")
    .map((request) => (request.postDataJSON() as { photoIds?: string[] }).photoIds?.length ?? 0);
  const sortedRelayout = [...relayoutSamplesMs].sort((left, right) => left - right);
  const relayoutP95Ms = sortedRelayout[Math.max(0, Math.ceil(sortedRelayout.length * 0.95) - 1)] ?? 0;
  const longestApplicationTaskMs = await page.evaluate(() => Math.max(0, ...((window as Window & { __albumLongTasks?: number[] }).__albumLongTasks ?? [])));
  const result: PerformanceResult = {
    environment: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      browser: page.context().browser()?.version() ?? "unknown",
    },
    heapGrowthBytes: finalHeap.usedSize - baseline.usedSize,
    mountedPhotoNodes,
    maxCursorConcurrency,
    maxRenewalBatchSize: Math.max(0, ...renewalBatchSizes),
    relayoutSamplesMs,
    relayoutP95Ms,
    longTaskDurationsMs: await page.evaluate(() => (window as Window & { __albumLongTasks?: number[] }).__albumLongTasks ?? []),
    longestApplicationTaskMs,
    geometryStable,
  };
  await mkdir(path.resolve("test-results"), { recursive: true });
  if (testInfo.repeatEachIndex === 0) {
    console.log("album-scale warm-up complete");
    return;
  }
  await writeFile(
    path.resolve("test-results", `album-scale-results-run-${testInfo.repeatEachIndex}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(`album-scale heap=${result.heapGrowthBytes} mounted=${result.mountedPhotoNodes} cursor=${result.maxCursorConcurrency} renewal=${result.maxRenewalBatchSize} relayout-p95=${result.relayoutP95Ms.toFixed(1)}ms long-task=${result.longestApplicationTaskMs}ms geometry=${result.geometryStable}`);

  expect(result.heapGrowthBytes).toBeLessThanOrEqual(MAX_HEAP_GROWTH_BYTES);
  expect(result.mountedPhotoNodes).toBeLessThanOrEqual(MAX_MOUNTED_PHOTO_NODES);
  expect(result.maxCursorConcurrency).toBe(1);
  expect(result.maxRenewalBatchSize).toBeGreaterThan(0);
  expect(result.maxRenewalBatchSize).toBeLessThanOrEqual(MAX_RENEWAL_BATCH);
  expect(result.relayoutP95Ms).toBeLessThan(MAX_RELAYOUT_P95_MS);
  expect(result.longestApplicationTaskMs).toBeLessThanOrEqual(MAX_LONG_TASK_MS);
  expect(result.geometryStable).toBe(true);
});
