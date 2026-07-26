import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimelineThumbnailSources } from "@album/shared";
import { renderApp } from "../../test/test-utils.js";
import { TimelineThumbnailImage } from "./TimelineThumbnailImage.js";

const sources = (url: string): TimelineThumbnailSources => ({
  large: { url, dimensions: { width: 640, height: 320 } },
});

describe("TimelineThumbnailImage", () => {
  it("shows a local placeholder after an actual load failure, with no per-Photo Retry control, and reports the outcome", () => {
    const onOutcome = vi.fn();
    const { container } = renderApp(
      <TimelineThumbnailImage
        fetchPriority="auto"
        height={100}
        leaseRevision={1}
        loading="eager"
        onOutcome={onOutcome}
        photoId="a"
        sources={sources("https://example.invalid/a.jpg")}
        width={100}
      />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("button")).not.toBeInTheDocument();
    expect(onOutcome).toHaveBeenCalledWith({ photoId: "a", leaseRevision: 1, outcome: "failed" });
  });

  it("tries again on its own once a new lease revision arrives, clearing the placeholder", () => {
    const onOutcome = vi.fn();
    const { container, rerender } = renderApp(
      <TimelineThumbnailImage
        fetchPriority="auto"
        height={100}
        leaseRevision={1}
        loading="eager"
        onOutcome={onOutcome}
        photoId="a"
        sources={sources("https://example.invalid/a.jpg")}
        width={100}
      />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).not.toBeInTheDocument();

    rerender(
      <TimelineThumbnailImage
        fetchPriority="auto"
        height={100}
        leaseRevision={2}
        loading="eager"
        onOutcome={onOutcome}
        photoId="a"
        sources={sources("https://example.invalid/a-renewed.jpg")}
        width={100}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", "https://example.invalid/a-renewed.jpg");
  });

  it("reports a successful load with the matching lease revision", () => {
    const onOutcome = vi.fn();
    const { container } = renderApp(
      <TimelineThumbnailImage
        fetchPriority="auto"
        height={100}
        leaseRevision={3}
        loading="eager"
        onOutcome={onOutcome}
        photoId="a"
        sources={sources("https://example.invalid/a.jpg")}
        width={100}
      />,
    );

    fireEvent.load(container.querySelector("img")!);

    expect(onOutcome).toHaveBeenCalledWith({ photoId: "a", leaseRevision: 3, outcome: "loaded" });
  });
});
