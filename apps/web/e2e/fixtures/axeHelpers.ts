import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Runs axe-core against the current page and fails on every real violation, regardless of
 * impact (execution plan Slice 0.2: "Fail on every real axe violation regardless of impact").
 *
 * `excludeSelectors` exists only for a narrowly documented false positive with an adjacent
 * explanation at the call site and a matching manual item in the acceptance template --
 * never for disabling a rule wholesale.
 */
export const expectNoAxeViolations = async (page: Page, excludeSelectors: string[] = []): Promise<void> => {
  const builder = new AxeBuilder({ page });
  if (excludeSelectors.length > 0) {
    builder.exclude(excludeSelectors);
  }
  const results = await builder.analyze();
  expect(results.violations, describeViolations(results.violations)).toEqual([]);
};

const describeViolations = (violations: unknown[]): string =>
  violations.length === 0
    ? "no violations"
    : JSON.stringify(violations, null, 2);
