import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TimelineThumbnailSources } from "@album/shared";
import { renderApp } from "../../test/test-utils.js";
import { TimelineThumbnailImage } from "./TimelineThumbnailImage.js";

const sources = (url: string): TimelineThumbnailSources => ({
  large: { url, dimensions: { width: 640, height: 320 } },
});

describe("TimelineThumbnailImage", () => {
  it("shows a local placeholder after an actual load failure, with no per-Photo Retry control", () => {
    const { container } = renderApp(
      <TimelineThumbnailImage fetchPriority="auto" height={100} loading="eager" sources={sources("https://example.invalid/a.jpg")} width={100} />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("button")).not.toBeInTheDocument();
  });

  it("tries again on its own once a renewed source URL arrives, clearing the placeholder", () => {
    const { container, rerender } = renderApp(
      <TimelineThumbnailImage fetchPriority="auto" height={100} loading="eager" sources={sources("https://example.invalid/a.jpg")} width={100} />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).not.toBeInTheDocument();

    rerender(
      <TimelineThumbnailImage fetchPriority="auto" height={100} loading="eager" sources={sources("https://example.invalid/a-renewed.jpg")} width={100} />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", "https://example.invalid/a-renewed.jpg");
  });
});
