// Popup: shows whether AXISNotes is reachable and paired, pairs with a code, and starts clips.

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  return "Browser";
}

function say(text, ok = true) {
  $("message").textContent = text;
  $("message").className = ok ? "ok" : "error";
}

async function refresh() {
  const s = await send({ type: "status" });
  $("state").textContent = !s.running
    ? "AXISNotes not running"
    : !s.paired
      ? "Not paired"
      : s.vault
        ? "Connected"
        : "No vault open";
  $("state").className = s.running && s.paired && s.vault ? "ok" : "warn";
  $("pair").hidden = s.paired;
  $("clip").hidden = !s.paired;
  $("queue").hidden = s.queue === 0;
  $("queue-text").textContent = `${s.queue} clip${s.queue === 1 ? "" : "s"} waiting for AXISNotes`;
  const { port } = await chrome.storage.local.get("port");
  $("port").value = port || "";
}

document.querySelectorAll("#clip button").forEach((b) =>
  b.addEventListener("click", async () => {
    document.querySelectorAll("#clip button").forEach((x) => (x.disabled = true));
    say("Clipping…");
    const r = await send({ type: "clip", kind: b.dataset.kind });
    say(r.message, r.ok);
    document.querySelectorAll("#clip button").forEach((x) => (x.disabled = false));
    await refresh();
  }),
);

$("pair").addEventListener("submit", async (e) => {
  e.preventDefault();
  // Firefox asks the user for host access (a user gesture is needed, so do it here).
  const origins = ["http://127.0.0.1/*"];
  if (!(await chrome.permissions.contains({ origins }))) {
    if (!(await chrome.permissions.request({ origins }))) {
      say("The extension needs access to 127.0.0.1 to reach AXISNotes.", false);
      return;
    }
  }
  const r = await send({ type: "pair", code: $("code").value, name: browserName() });
  if (r.error) say(r.error, false);
  else say("Paired. Clips now go to your vault.");
  await refresh();
});

$("retry").addEventListener("click", async () => {
  const r = await send({ type: "retry" });
  say(
    r.sent ? `Sent ${r.sent} clip${r.sent === 1 ? "" : "s"}.` : "AXISNotes still isn't reachable.",
    r.sent > 0,
  );
  await refresh();
});

$("port").addEventListener("change", async () => {
  await send({ type: "port", port: $("port").value });
  await refresh();
});

$("unpair").addEventListener("click", async () => {
  await send({ type: "unpair" });
  say("Unpaired.");
  await refresh();
});

void refresh();
