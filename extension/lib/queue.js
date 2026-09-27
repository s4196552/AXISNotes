// Delivering clips to the AXISNotes desktop app, with an offline queue: if AXISNotes isn't running
// (or has no vault open), the clip is kept in extension storage and sent later. Each clip
// has an id, so a retry that AXISNotes already received isn't saved twice.

export const DEFAULT_PORT = 38417;
export const QUEUE_KEY = "queue";
export const MAX_QUEUED = 200;

/**
 * @typedef {{ get(key: string): Promise<unknown>, set(key: string, value: unknown): Promise<void> }} Storage
 * @typedef {{ fetch: typeof fetch, storage: Storage, port?: number, token?: string | null }} Env
 */

export const baseUrl = (port = DEFAULT_PORT) => `http://127.0.0.1:${port}/v1`;

/** A new clip with an id and timestamp. */
export function newClip(kind, data) {
  return { id: crypto.randomUUID(), kind, createdMs: Date.now(), ...data };
}

/**
 * Send one clip.
 * @returns {Promise<"sent" | "retry" | "unpaired" | { error: string }>}
 */
export async function sendClip(clip, env) {
  if (!env.token) return "unpaired";
  let res;
  try {
    res = await env.fetch(`${baseUrl(env.port)}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.token}` },
      body: JSON.stringify(clip),
    });
  } catch {
    return "retry"; // AXISNotes isn't running
  }
  if (res.ok) return "sent";
  if (res.status === 401) return "unpaired";
  if (res.status === 503 || res.status >= 500) return "retry";
  let message = `AXISNotes refused the clip (${res.status})`;
  try {
    message = (await res.json()).error || message;
  } catch {
    // keep the generic message
  }
  return { error: message };
}

export async function queued(storage) {
  const q = await storage.get(QUEUE_KEY);
  return Array.isArray(q) ? q : [];
}

async function enqueue(storage, clip) {
  const q = await queued(storage);
  if (!q.some((c) => c.id === clip.id)) q.push(clip);
  await storage.set(QUEUE_KEY, q.slice(-MAX_QUEUED));
}

/** Send a clip now, or queue it for later. */
export async function deliver(clip, env) {
  const result = await sendClip(clip, env);
  if (result === "retry" || result === "unpaired") await enqueue(env.storage, clip);
  return result;
}

/**
 * Send queued clips, oldest first. Stops at the first one that has to wait (AXISNotes not
 * running); drops clips AXISNotes rejects as invalid.
 * @returns {Promise<{ sent: number, left: number, errors: string[] }>}
 */
export async function flush(env) {
  const q = await queued(env.storage);
  const errors = [];
  let sent = 0;
  let i = 0;
  for (; i < q.length; i++) {
    const r = await sendClip(q[i], env);
    if (r === "retry" || r === "unpaired") break;
    if (r === "sent") sent++;
    else errors.push(r.error);
  }
  const left = q.slice(i);
  await env.storage.set(QUEUE_KEY, left);
  return { sent, left: left.length, errors };
}

/** Status for the popup. */
export async function status(env) {
  const queue = (await queued(env.storage)).length;
  try {
    const res = await env.fetch(`${baseUrl(env.port)}/status`, {
      headers: env.token ? { Authorization: `Bearer ${env.token}` } : {},
    });
    const s = await res.json();
    return { running: true, paired: Boolean(s.paired), vault: Boolean(s.vault), queue };
  } catch {
    return { running: false, paired: Boolean(env.token), vault: false, queue };
  }
}

/** Trade a pairing code shown in AXISNotes for a token. */
export async function pair(code, name, env) {
  let res;
  try {
    res = await env.fetch(`${baseUrl(env.port)}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim(), name }),
    });
  } catch {
    return { error: "AXISNotes isn't running on this computer." };
  }
  const body = await res.json().catch(() => ({}));
  return res.ok ? { token: body.token } : { error: body.error || `Pairing failed (${res.status})` };
}
