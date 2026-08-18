import { describe, expect, test } from "vitest";

import { getTaskFailureClassification } from "./task-processor";

describe("Tasker failure persistence", () => {
  test("persists only an allowlisted code or error class", () => {
    expect(getTaskFailureClassification(new Error("attendee@example.com should never persist"))).toBe("Error");
    expect(getTaskFailureClassification({ code: "P2025", message: "sensitive row detail" })).toBe("P2025");
    expect(getTaskFailureClassification({ code: "UNTRUSTED", message: "sensitive row detail" })).toBe("TaskExecutionError");
  });
});
