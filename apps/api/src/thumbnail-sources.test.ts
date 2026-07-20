import { buildTimelineThumbnailSources } from "./thumbnail-sources.js";

describe("buildTimelineThumbnailSources", () => {
  it("exposes both sources when actual widths differ", () => {
    expect(
      buildTimelineThumbnailSources({
        small: { url: "https://small", dimensions: { width: 320, height: 213 } },
        large: { url: "https://large", dimensions: { width: 640, height: 427 } },
      }),
    ).toEqual({
      small: { url: "https://small", dimensions: { width: 320, height: 213 } },
      large: { url: "https://large", dimensions: { width: 640, height: 427 } },
    });
  });

  it("collapses to Large when actual widths match", () => {
    expect(
      buildTimelineThumbnailSources({
        small: { url: "https://small", dimensions: { width: 200, height: 133 } },
        large: { url: "https://large", dimensions: { width: 200, height: 133 } },
      }),
    ).toEqual({
      large: { url: "https://large", dimensions: { width: 200, height: 133 } },
    });
  });
});
