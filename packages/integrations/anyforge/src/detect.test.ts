import { describe, expect, it } from "vitest";
import { isForgejoHost, parseRemoteHost, parseRemoteUrl } from "./detect.ts";

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

describe("parseRemoteUrl", () => {
  it("parses HTTPS remote into host/owner/repo", () => {
    expect(parseRemoteUrl("https://codeberg.org/forgejo/forgejo.git")).toEqual({
      host: "codeberg.org",
      owner: "forgejo",
      repo: "forgejo",
    });
  });
  it("parses SCP-style SSH remote", () => {
    expect(parseRemoteUrl("git@codeberg.org:forgejo/forgejo.git")).toEqual({
      host: "codeberg.org",
      owner: "forgejo",
      repo: "forgejo",
    });
  });
  it("returns null for local path", () => {
    expect(parseRemoteUrl("/srv/git/repo.git")).toBeNull();
  });
  it("returns null when only one path component", () => {
    expect(parseRemoteUrl("https://codeberg.org/forgejo")).toBeNull();
  });
});

describe("isForgejoHost", () => {
  it("returns true for codeberg.org", () => {
    expect(isForgejoHost("codeberg.org")).toBe(true);
  });
  it("returns false for github.com", () => {
    expect(isForgejoHost("github.com")).toBe(false);
  });
  it("returns false for unknown host", () => {
    expect(isForgejoHost("gitlab.example.com")).toBe(false);
  });
});
