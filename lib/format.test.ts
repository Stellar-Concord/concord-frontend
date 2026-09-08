import { describe, expect, it } from "vitest";
import { statusLabel, truncateAddress } from "./format";

describe("truncateAddress", () => {
  it("shortens a long address to first/last N chars", () => {
    expect(
      truncateAddress("GDGIEBO3SQIMCTUBYGVFQ2QSSJT67LABW6QLR7RPEMCHF4JMLS7P6AYC"),
    ).toBe("GDGI...6AYC");
  });

  it("leaves a short string untouched", () => {
    expect(truncateAddress("SHORT")).toBe("SHORT");
  });

  it("respects a custom chars length", () => {
    expect(
      truncateAddress(
        "GDGIEBO3SQIMCTUBYGVFQ2QSSJT67LABW6QLR7RPEMCHF4JMLS7P6AYC",
        6,
      ),
    ).toBe("GDGIEB...7P6AYC");
  });

  it("doesn't truncate a string right at the boundary", () => {
    // length === chars*2 + 3 exactly -> truncating would save nothing
    const boundary = "A".repeat(4 * 2 + 3);
    expect(truncateAddress(boundary)).toBe(boundary);
  });
});

describe("statusLabel", () => {
  it("title-cases a single word", () => {
    expect(statusLabel("created")).toBe("Created");
  });

  it("splits snake_case into title-cased words", () => {
    expect(statusLabel("in_progress")).toBe("In Progress");
  });
});
