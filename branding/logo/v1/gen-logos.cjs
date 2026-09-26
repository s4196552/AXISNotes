// Generates AXIS logo SVGs: a minimalist compass whose three axes form an "A".
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const f = (n) => +n.toFixed(2);
const rad = (d) => (d * Math.PI) / 180;

// Balanced spectrum (avoids the lime-heavy middle of a plain HSL sweep)
const STOPS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#00c7be",
  "#0a84ff",
  "#5e5ce6",
  "#bf5af2",
];
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function hue(t) {
  t = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t)),
    u = t - i;
  const [a, b] = [hex2(STOPS[i]), hex2(STOPS[i + 1])];
  return (
    "#" +
    a
      .map((v, k) =>
        Math.round(v + (b[k] - v) * u)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function linGrad(id, x1, y1, x2, y2, t0 = 0, t1 = 1, stops = 8) {
  let s = "";
  for (let i = 0; i < stops; i++) {
    const u = i / (stops - 1);
    s += `<stop offset="${f(u)}" stop-color="${hue(t0 + (t1 - t0) * u)}"/>`;
  }
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${s}</linearGradient>`;
}

const polar = (c, r, deg) => [c[0] + r * Math.sin(rad(deg)), c[1] - r * Math.cos(rad(deg))];

// Rainbow arc made of short segments (SVG has no conic gradient)
function rainbowArc(c, r, degFrom, degTo, w, t0 = 0, t1 = 1, N = 72) {
  let s = "";
  const dir = degTo > degFrom ? 1 : -1;
  for (let i = 0; i < N; i++) {
    const a0 = degFrom + ((degTo - degFrom) * i) / N;
    const a1 = degFrom + ((degTo - degFrom) * (i + 1)) / N + (i < N - 1 ? 0.8 * dir : 0);
    const [x0, y0] = polar(c, r, a0),
      [x1, y1] = polar(c, r, a1);
    s += `<path d="M${f(x0)} ${f(y0)}A${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${f(x1)} ${f(y1)}" stroke="${hue(t0 + ((t1 - t0) * i) / (N - 1))}"/>`;
  }
  const [sx, sy] = polar(c, r, degFrom),
    [ex, ey] = polar(c, r, degTo);
  return (
    `<g fill="none" stroke-width="${w}">${s}</g>` +
    `<circle cx="${f(sx)}" cy="${f(sy)}" r="${w / 2}" fill="${hue(t0)}"/>` +
    `<circle cx="${f(ex)}" cy="${f(ey)}" r="${w / 2}" fill="${hue(t1)}"/>`
  );
}

function chevron(S, E, len = 16, spread = 32) {
  const ang = Math.atan2(E[1] - S[1], E[0] - S[0]) + Math.PI;
  const p = (d) => [E[0] + len * Math.cos(ang + rad(d)), E[1] + len * Math.sin(ang + rad(d))];
  const [a, b] = [p(spread), p(-spread)];
  return `M${f(a[0])} ${f(a[1])}L${f(E[0])} ${f(E[1])}L${f(b[0])} ${f(b[1])}`;
}

const svg = (vb, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="AXIS"><title>AXIS</title>${body}</svg>\n`;

const INK_LIGHT_BG = "#15161f";
const INK_DARK_BG = "#f4f5f9";
const files = {};

// ---- 1. Dial: navigation compass, rainbow tick bezel, A inscribed ------------
const C = [128, 128];
const dial = {
  apex: [128, 30],
  feet: [polar(C, 90, -152), polar(C, 90, 152)],
  barY: 128,
  barX: [128 - 84, 128 + 84],
};
function dialTicks() {
  let s = "";
  const N = 48;
  for (let i = 1; i < N; i++) {
    // i = 0 is north: the A's apex takes its place
    const deg = (360 * i) / N;
    const major = i % 12 === 0;
    if (major && (deg === 90 || deg === 270)) continue; // crossbar meets E/W
    const [a, b] = [polar(C, major ? 94 : 99, deg), polar(C, 108, deg)];
    s += `<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}" stroke="${hue((N - 1 - i) / (N - 2))}" stroke-width="${major ? 7 : 5}"/>`;
  }
  // E and W are dots at the ends of the crossbar
  return `<g stroke-linecap="round">${s}</g>`;
}
const dialA = (stroke) =>
  `<path d="M${f(dial.feet[0][0])} ${f(dial.feet[0][1])}L${dial.apex[0]} ${dial.apex[1]}L${f(dial.feet[1][0])} ${f(dial.feet[1][1])}` +
  `M${dial.barX[0]} ${dial.barY}H${dial.barX[1]}" fill="none" stroke="${stroke}" stroke-width="14" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10"/>`;

files["axis-dial-light.svg"] = svg("0 0 256 256", dialTicks() + dialA(INK_LIGHT_BG));
files["axis-dial-dark.svg"] = svg("0 0 256 256", dialTicks() + dialA(INK_DARK_BG));
files["axis-dial-rainbow.svg"] = svg(
  "0 0 256 256",
  `<defs>${linGrad("g", 44, 0, 212, 0)}</defs>` + dialTicks() + dialA("url(#g)"),
);

// ---- 2. Drafting compass: the tool itself is the A, drawing a rainbow arc -----
{
  const hinge = [128, 34];
  const needle = [96, 160],
    pencil = [168, 160];
  const r = pencil[0] - needle[0]; // arc really is centred on the needle
  const legAt = (y, foot) =>
    hinge[0] + ((y - hinge[1]) / (foot[1] - hinge[1])) * (foot[0] - hinge[0]);
  const armY = 108;
  const body = (ink) =>
    // arc: from 245° (upper left, oldest = red) round the bottom to the pencil tip at 90° (violet)
    `<g transform="translate(24 0)">` +
    rainbowArc(needle, r, 292, 90, 10, 0, 1, 90) +
    `<g fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M128 6V${hinge[1] - 11}" stroke-width="10"/>` +
    `<circle cx="${hinge[0]}" cy="${hinge[1]}" r="11" stroke-width="9"/>` +
    `<path d="M${f(legAt(hinge[1] + 11, needle))} ${hinge[1] + 11}L${needle[0]} ${needle[1]}` +
    `M${f(legAt(hinge[1] + 11, pencil))} ${hinge[1] + 11}L${pencil[0]} ${pencil[1]}" stroke-width="13"/>` +
    `<path d="M${f(legAt(armY, needle) - 12)} ${armY}H${f(legAt(armY, pencil) + 12)}" stroke-width="11"/>` +
    `</g></g>`;
  files["axis-drafting-light.svg"] = svg("0 0 256 256", body(INK_LIGHT_BG));
  files["axis-drafting-dark.svg"] = svg("0 0 256 256", body(INK_DARK_BG));
}

// ---- 3. Axes: three arrows form the A; cardinal ticks hint at a compass -----
{
  const apex = [128, 34],
    fl = [72, 206],
    fr = [184, 206],
    by = 138;
  const bl = [30, by],
    br = [226, by];
  const defs =
    linGrad("gl", apex[0], apex[1], fl[0], fl[1], 0.0, 0.3, 3) +
    linGrad("gb", bl[0], by, br[0], by, 0.36, 0.64, 3) +
    linGrad("gr", apex[0], apex[1], fr[0], fr[1], 0.72, 1.0, 3);
  const grey = "#8b90a6";
  files["axis-axes.svg"] = svg(
    "0 0 256 256",
    `<defs>${defs}</defs>` +
      `<g fill="none" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M${apex[0]} ${apex[1]}L${fl[0]} ${fl[1]}${chevron(apex, fl, 18)}" stroke="url(#gl)"/>` +
      `<path d="M${apex[0]} ${apex[1]}L${fr[0]} ${fr[1]}${chevron(apex, fr, 18)}" stroke="url(#gr)"/>` +
      `<path d="M${bl[0]} ${by}H${br[0]}${chevron(bl, br, 18)}${chevron(br, bl, 18)}" stroke="url(#gb)"/>` +
      `</g>` +
      `<path d="M128 6v8M128 236v12" stroke="${grey}" stroke-width="6" stroke-linecap="round"/>` +
      "",
  );
}

// ---- 4. Glyph / favicon -----------------------------------------------------
files["axis-glyph.svg"] = svg(
  "0 0 64 64",
  `<defs>${linGrad("g", 4, 0, 60, 0)}</defs>` +
    `<path d="M11 59L32 5L53 59M5 40H59" fill="none" stroke="url(#g)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10"/>`,
);

// ---- 5. App icon: dial on a dark rounded square ------------------------------
files["axis-app-icon.svg"] = svg(
  "0 0 512 512",
  `<defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#1d1f35"/><stop offset="1" stop-color="#0b0c16"/></radialGradient></defs>` +
    `<rect width="512" height="512" rx="114" fill="url(#bg)"/>` +
    `<g transform="translate(64 64) scale(1.5)">${dialTicks()}${dialA(INK_DARK_BG)}</g>`,
);

for (const f of fs.readdirSync(OUT)) if (f.endsWith(".svg")) fs.unlinkSync(path.join(OUT, f));
for (const [name, body] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), body);
  console.log(name, body.length, "bytes");
}

// ---- Preview sheet (images inlined so it opens anywhere) --------------------
const uri = (n) => "data:image/svg+xml;base64," + Buffer.from(files[n]).toString("base64");
const names = Object.keys(files);
const onLight = names.filter((n) => !n.endsWith("-dark.svg"));
const onDark = names.filter((n) => !n.endsWith("-light.svg"));
const card = (n, bg, fg) =>
  `<figure style="background:${bg};color:${fg}"><img src="${uri(n)}" width="150" height="150" alt=""><figcaption>${n}</figcaption></figure>`;
const sizes = (n, bg) =>
  `<div class="sizes" style="background:${bg}">${[64, 32, 24, 16].map((s) => `<img src="${uri(n)}" width="${s}" height="${s}">`).join("")}</div>`;
const html = `<!doctype html><meta charset="utf-8"><title>AXIS logos</title>
<style>
body{margin:0;padding:24px;font:13px/1.4 system-ui,sans-serif;background:#ececf1;color:#222}
h2{margin:20px 0 8px;font-size:14px;font-weight:600}
.row{display:flex;flex-wrap:wrap;gap:14px}
figure{margin:0;padding:18px;border-radius:14px;display:flex;flex-direction:column;align-items:center;gap:8px;width:180px}
figcaption{font-size:11px;opacity:.7}
.sizes{display:flex;align-items:end;gap:16px;padding:16px;border-radius:14px}
</style>
<h2>On light</h2><div class="row">${onLight.map((n) => card(n, "#fff", "#222")).join("")}</div>
<h2>On dark</h2><div class="row">${onDark.map((n) => card(n, "#101118", "#ddd")).join("")}</div>
<h2>Small sizes: glyph · dial · drafting · app icon</h2>
<div class="row">${sizes("axis-glyph.svg", "#fff")}${sizes("axis-dial-light.svg", "#fff")}${sizes("axis-drafting-light.svg", "#fff")}${sizes("axis-app-icon.svg", "#101118")}</div>`;
fs.writeFileSync(path.join(OUT, "preview.html"), html);
console.log("preview.html");
