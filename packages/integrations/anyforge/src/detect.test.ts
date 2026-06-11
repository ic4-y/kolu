import { describe, expect, it } from "vitest";
import { detectForge, parseRemoteHost } from "./detect.ts";

describe("parseRemoteHost", () => {
  it("parses HTTPS remote", () => {
    expect(parseRemoteHost("https://github.com/juspay/kolu.git")).toBe(
      "github.com",
    );
  });
  it("parses HTTPS remote without .git", () => {
    expect(parseRemoteHost("https://codeberg.org/forgejo/forgejo")).toBe(
      "codeberg.org",
    );
  });
  it("parses SCP-style SSH remote with user", () => {
    expect(parseRemoteHost("git@github.com:juspay/kolu.git")).toBe(
      "github.com",
    );
  });
  it("parses SCP-style SSH remote with ssh:// prefix", () => {
    expect(parseRemoteHost("ssh://git@codeberg.org/forgejo/forgejo.git")).toBe(
      "codeberg.org",
    );
  });
  it("parses userless SCP-style remote (SSH config)", () => {
    expect(parseRemoteHost("codeberg.org:owner/repo.git")).toBe("codeberg.org");
  });
  it("returns null for local path", () => {
    expect(parseRemoteHost("/srv/git/repo.git")).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(parseRemoteHost("")).toBeNull();
  });
  it("lowercases host", () => {
    expect(parseRemoteHost("https://GitHub.com/owner/repo.git")).toBe(
      "github.com",
    );
  });
  it("parses remote with port", () => {
    expect(
      parseRemoteHost("https://forgejo.example.com:3000/owner/repo.git"),
    ).toBe("forgejo.example.com");
  });
});

describe("detectForge", () => {
  it("returns github for null remote", () => {
    expect(detectForge(null)).toBe("github");
  });
  it("returns github for github.com remote", () => {
    expect(detectForge("https://github.com/juspay/kolu.git")).toBe("github");
  });
  it("returns forgejo for codeberg.org remote", () => {
    expect(detectForge("https://codeberg.org/forgejo/forgejo")).toBe("forgejo");
  });
  it("returns forgejo for codeberg.org SCP-style remote", () => {
    expect(detectForge("git@codeberg.org:forgejo/forgejo.git")).toBe("forgejo");
  });
  it("returns forgejo for userless SCP-style codeberg remote", () => {
    expect(detectForge("codeberg.org:owner/repo.git")).toBe("forgejo");
  });
  it("returns github for unknown host", () => {
    expect(detectForge("https://gitlab.com/owner/repo.git")).toBe("github");
  });
  it("returns github for unparseable remote", () => {
    expect(detectForge("/srv/git/repo.git")).toBe("github");
  });
});
