import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProcessingIssuesNavCount, type ProcessingIssuesNavCount } from "./processingIssuesNavCount.js";
import { createTestProcessingIssuesPort, type TestProcessingIssuesPort } from "./testProcessingIssuesPort.js";

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createProcessingIssuesNavCount", () => {
  let test: TestProcessingIssuesPort;
  let navCount: ProcessingIssuesNavCount | undefined;

  beforeEach(() => {
    test = createTestProcessingIssuesPort();
  });

  afterEach(() => {
    navCount?.dispose();
  });

  it("is undefined until refresh() is called and its fetch resolves", async () => {
    navCount = createProcessingIssuesNavCount({ port: test.port });
    expect(navCount.getSnapshot().openCount).toBeUndefined();
    expect(test.getSummaryCalls).toBe(0);

    navCount.intents.refresh();
    expect(test.getSummaryCalls).toBe(1);
    test.resolveNextGetSummary({ openCount: 3 });
    await flush();

    expect(navCount.getSnapshot().openCount).toBe(3);
  });

  it("refresh() re-fetches and updates the count", async () => {
    navCount = createProcessingIssuesNavCount({ port: test.port });
    navCount.intents.refresh();
    test.resolveNextGetSummary({ openCount: 3 });
    await flush();

    navCount.intents.refresh();
    expect(test.getSummaryCalls).toBe(2);
    test.resolveNextGetSummary({ openCount: 1 });
    await flush();

    expect(navCount.getSnapshot().openCount).toBe(1);
  });

  it("leaves the last-known count in place when a refresh fails", async () => {
    navCount = createProcessingIssuesNavCount({ port: test.port });
    navCount.intents.refresh();
    test.resolveNextGetSummary({ openCount: 2 });
    await flush();

    navCount.intents.refresh();
    test.rejectNextGetSummary(new Error("boom"));
    await flush();

    expect(navCount.getSnapshot().openCount).toBe(2);
  });

  it("dispose aborts in-flight requests and becomes a no-op for further refreshes", async () => {
    navCount = createProcessingIssuesNavCount({ port: test.port });
    navCount.intents.refresh();

    navCount.dispose();
    await flush();

    expect(navCount.getSnapshot().openCount).toBeUndefined();
    navCount.intents.refresh();
    expect(test.getSummaryCalls).toBe(1);
  });

  it("notifies subscribers when the count changes", async () => {
    navCount = createProcessingIssuesNavCount({ port: test.port });
    let notified = 0;
    navCount.subscribe(() => {
      notified += 1;
    });

    navCount.intents.refresh();
    test.resolveNextGetSummary({ openCount: 5 });
    await flush();

    expect(notified).toBe(1);
  });
});
