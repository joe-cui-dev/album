import { test as base } from "@playwright/test";
import { AlbumApiMock, resetPhotoCounter, resetProcessingIssueCounter, resetUploadPhotoCounter } from "./albumApiMock.js";

/**
 * One `AlbumApiMock` installed on `page` before every test, with the photo-id counter
 * reset for deterministic fixtures. Also fails the test on any uncaught page exception,
 * so an API failure that should be caught and shown as UI state doesn't silently crash instead.
 */
export const test = base.extend<{ mock: AlbumApiMock }>({
  mock: async ({ page }, use) => {
    resetPhotoCounter();
    resetProcessingIssueCounter();
    resetUploadPhotoCounter();
    const mock = new AlbumApiMock(page);
    await mock.install();

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await use(mock);

    if (pageErrors.length > 0) {
      throw new Error(`Uncaught page error(s): ${pageErrors.map((error) => error.message).join("; ")}`);
    }
  },
});

export { expect } from "@playwright/test";
