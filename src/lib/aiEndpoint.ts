// Which AI endpoints are on this computer. Mirrors `is_local_url` and `plaintext_remote`
// in src-tauri/src/ai (the Rust copy is the one that's enforced; this one is for the
// in-memory backend and for showing problems next to the endpoint box).
//
// Both parse with WHATWG URL rules, so the host is what the HTTP client would connect to:
// `http://evil.com#.localhost`, `http://evil.com\.localhost` and
// `http://localhost@evil.com` all go to evil.com.

/** Shown when an endpoint would send API keys and notes over unencrypted HTTP. */
export const PLAIN_HTTP_REMOTE =
  "Plain http:// is only allowed for a server on this computer (localhost, 127.0.0.1 or [::1]). Use https:// for other servers, so API keys and notes aren't sent unencrypted.";

/**
 * True if requests to `url` stay on this computer: http(s), no user info, and a loopback
 * IP, `localhost` or a `*.localhost` name. Anything unparsable is not local. A local
 * server can still forward requests elsewhere, so this doesn't prove on-device inference.
 */
export function isLocalUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) {
    return false;
  }
  const host = u.hostname; // lowercased; IPv4 normalized; IPv6 in brackets
  return (
    host === "localhost" ||
    (host.length > ".localhost".length && host.endsWith(".localhost")) ||
    host === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  );
}

/** An `http://` endpoint on another computer: keys and notes would go unencrypted. */
export const isPlaintextRemote = (url: string) =>
  /^http:\/\//i.test(url.trim()) && !isLocalUrl(url);
