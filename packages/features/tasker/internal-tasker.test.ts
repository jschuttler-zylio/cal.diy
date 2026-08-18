import { describe, expect, test } from "vitest";

import { getTaskCleanupCutoff, getTaskRetentionDays } from "./internal-tasker";

describe("qualification Tasker retention", () => {
  test("uses the enforced default for missing or unsafe retention values", () => {
    expect(getTaskRetentionDays()).toBe(30);
    expect(getTaskRetentionDays("6")).toBe(30);
    expect(getTaskRetentionDays("3651")).toBe(30);
  });

  test("calculates a stable cutoff from a valid retention period", () => {
    expect(getTaskRetentionDays("45")).toBe(45);
    expect(getTaskCleanupCutoff(new Date("2026-08-18T00:00:00.000Z"), 45).toISOString()).toBe(
      "2026-07-04T00:00:00.000Z"
    );
  });
});
