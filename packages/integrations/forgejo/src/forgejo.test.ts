import { describe, expect, it } from "vitest";
import {
  classifyForgejoError,
  deriveForgejoCheckStatus,
  extractForgejoChecks,
  mapForgejoPrState,
} from "./forgejo.ts";

describe("deriveForgejoCheckStatus", () => {
  it("returns null for undefined statuses", () => {
    expect(deriveForgejoCheckStatus(undefined)).toBeNull();
  });
  it("returns null for empty statuses", () => {
    expect(deriveForgejoCheckStatus([])).toBeNull();
  });
  it("returns pass when all success", () => {
    expect(
      deriveForgejoCheckStatus([{ status: "success" }, { status: "success" }]),
    ).toBe("pass");
  });
  it("returns pending when any pending", () => {
    expect(
      deriveForgejoCheckStatus([{ status: "success" }, { status: "pending" }]),
    ).toBe("pending");
  });
  it("returns fail on failure (short-circuit)", () => {
    expect(
      deriveForgejoCheckStatus([
        { status: "success" },
        { status: "failure" },
        { status: "pending" },
      ]),
    ).toBe("fail");
  });
  it("returns fail on error", () => {
    expect(deriveForgejoCheckStatus([{ status: "error" }])).toBe("fail");
  });
  it("treats warning as pass (non-blocking)", () => {
    expect(deriveForgejoCheckStatus([{ status: "warning" }])).toBe("pass");
  });
});

describe("extractForgejoChecks", () => {
  it("returns empty for undefined", () => {
    expect(extractForgejoChecks(undefined)).toEqual([]);
  });
  it("maps context to name and status to outcome", () => {
    expect(
      extractForgejoChecks([
        { status: "success", context: "build" },
        { status: "failure", context: "test" },
      ]),
    ).toEqual([
      { name: "build", outcome: "pass" },
      { name: "test", outcome: "fail" },
    ]);
  });
  it("uses ? for missing context", () => {
    expect(extractForgejoChecks([{ status: "success" }])).toEqual([
      { name: "?", outcome: "pass" },
    ]);
  });
});

describe("mapForgejoPrState", () => {
  it("maps open to open", () => {
    expect(mapForgejoPrState({ state: "open", merged: false })).toBe("open");
  });
  it("maps closed+merged to merged", () => {
    expect(mapForgejoPrState({ state: "closed", merged: true })).toBe("merged");
  });
  it("maps closed+not-merged to closed", () => {
    expect(mapForgejoPrState({ state: "closed", merged: false })).toBe(
      "closed",
    );
  });
});

describe("classifyForgejoError", () => {
  it("classifies 401 as not-authenticated", () => {
    const result = classifyForgejoError({ status: 401 });
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "not-authenticated" },
    });
  });
  it("classifies 403 as not-authenticated", () => {
    const result = classifyForgejoError({ status: 403 });
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "not-authenticated" },
    });
  });
  it("classifies 404 as not-found", () => {
    const result = classifyForgejoError({ status: 404 });
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "not-found" },
    });
  });
  it("classifies ETIMEDOUT as timed-out", () => {
    const result = classifyForgejoError({ code: "ETIMEDOUT" });
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "timed-out" },
    });
  });
  it("classifies AbortError as timed-out", () => {
    const result = classifyForgejoError({ code: "AbortError" });
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "timed-out" },
    });
  });
  it("classifies unknown HTTP error as unknown", () => {
    const result = classifyForgejoError({ status: 500 });
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "unknown" },
    });
  });
  it("classifies non-HTTP error as unknown", () => {
    const result = classifyForgejoError(new Error("network down"));
    expect(result).toEqual({
      kind: "unavailable",
      source: { provider: "forgejo", code: "unknown" },
    });
  });
});
