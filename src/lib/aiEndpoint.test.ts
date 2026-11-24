// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isLocalUrl, isPlaintextRemote } from "./aiEndpoint";

describe("AI endpoint locality (mirrors src-tauri/src/ai/mod.rs)", () => {
  it("accepts loopback addresses and localhost names", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://127.1.2.3/v1",
      "http://[::1]:8080",
      "http://[0:0:0:0:0:0:0:1]/v1",
      "http://foo.localhost",
      "http://LOCALHOST:11434/v1",
      "https://localhost/v1",
    ])
      expect(isLocalUrl(url), url).toBe(true);
  });

  it("rejects crafted lookalikes and anything unparsable", () => {
    for (const url of [
      "http://127.0.0.1.evil.com/v1",
      "http://evil.com#.localhost",
      "http://evil.com\\.localhost",
      "http://localhost@evil.com",
      "http://user:pass@localhost/v1",
      "http://localhost./v1",
      "http://.localhost/v1",
      "http://0.0.0.0:11434",
      "http://[::ffff:127.0.0.1]/v1",
      "http://192.168.1.10:11434/v1",
      "file://localhost/x",
      "localhost:11434",
      "not a url",
      "",
    ])
      expect(isLocalUrl(url), url).toBe(false);
  });

  it("flags plain http only for other computers", () => {
    expect(isPlaintextRemote("http://192.168.1.10:11434/v1")).toBe(true);
    expect(isPlaintextRemote("HTTP://example.com/v1")).toBe(true);
    expect(isPlaintextRemote("http://localhost@evil.com")).toBe(true);
    expect(isPlaintextRemote("http://localhost:11434/v1")).toBe(false);
    expect(isPlaintextRemote("https://example.com/v1")).toBe(false);
    expect(isPlaintextRemote("")).toBe(false);
  });
});
