import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ metadata: vi.fn() }));

vi.mock("sharp", () => ({
  default: vi.fn(() => ({ metadata: mocks.metadata })),
}));

import { detectContentType } from "./imageUtils";

describe("detectContentType", () => {
  beforeEach(() => {
    mocks.metadata.mockReset();
  });

  it("maps sharp's HEIF metadata format to the AVIF content type", async () => {
    mocks.metadata.mockResolvedValue({ format: "heif" });

    await expect(detectContentType(Buffer.from("non-image"))).resolves.toBe("image/avif");
  });
});
