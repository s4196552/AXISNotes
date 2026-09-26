// AXIS "tripod" logos: a two-ring hub with three tapered, bold-headed axis arrows.
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });

const f = (n) => +n.toFixed(2);
const rad = (d) => (d * Math.PI) / 180;

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
function linGrad(id, p0, p1, t0, t1, stops = 4) {
  let s = "";
  for (let i = 0; i < stops; i++) {
    const u = i / (stops - 1);
    s += `<stop offset="${f(u)}" stop-color="${hue(t0 + (t1 - t0) * u)}"/>`;
  }
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(p0[0])}" y1="${f(p0[1])}" x2="${f(p1[0])}" y2="${f(p1[1])}">${s}</linearGradient>`;
}
// deg measured clockwise from north
const polar = (c, r, deg) => [c[0] + r * Math.sin(rad(deg)), c[1] - r * Math.cos(rad(deg))];

function mix(a, b, u) {
  const [p, q] = [hex2(a), hex2(b)];
  return (
    "#" +
    p
      .map((v, k) =>
        Math.round(v + (q[k] - v) * u)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function wheel(deg) {
  const a = ((deg % 360) + 360) % 360,
    CL = 10;
  if (a >= CL && a <= 360 - CL) return hue((a - CL) / (360 - 2 * CL));
  return mix(hue(1), hue(0), ((a + CL) % 360) / (2 * CL));
}
// Conic rainbow ring (full turn, seam at north – hidden under the up-axis root)
function conicRing(c, r, w, N = 90) {
  let s = "";
  for (let i = 0; i < N; i++) {
    const a0 = (360 * i) / N,
      a1 = (360 * (i + 1)) / N + 0.8;
    const [x0, y0] = polar(c, r, a0),
      [x1, y1] = polar(c, r, a1);
    s += `<path d="M${f(x0)} ${f(y0)}A${r} ${r} 0 0 1 ${f(x1)} ${f(y1)}" stroke="${wheel((a0 + a1 - 0.8) / 2)}"/>`;
  }
  return `<g fill="none" stroke-width="${w}">${s}</g>`;
}

// One tapered arrow as a single polygon: wide at the hub, thin at the neck, bold head.
function arrowPath(c, deg, g) {
  const P = (along, across) => {
    const u = [Math.sin(rad(deg)), -Math.cos(rad(deg))];
    const n = [-u[1], u[0]];
    return [c[0] + u[0] * along + n[0] * across, c[1] + u[1] * along + n[1] * across];
  };
  const neck = g.L - g.headLen;
  const pts = [
    P(g.r0, g.w0 / 2),
    P(neck, g.w1 / 2),
    P(neck, g.headW / 2),
    P(g.L, 0),
    P(neck, -g.headW / 2),
    P(neck, -g.w1 / 2),
    P(g.r0, -g.w0 / 2),
  ];
  return "M" + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join("L") + "Z";
}

function tripod({
  size = 256,
  L,
  legDeg = 120,
  hubR,
  hubW,
  innerR,
  innerW,
  w0,
  w1,
  headLen,
  headW,
  round = 3,
  paint = "rainbow",
  ink = "#15161f",
  idp = "",
}) {
  const degs = [0, legDeg, 360 - legDeg];
  // vertically centre the whole mark (arrow tips are the extremes)
  const down = -L * Math.cos(rad(legDeg));
  const c = [size / 2, size / 2 + (L - down) / 2];
  const g = { L, r0: hubR, w0, w1, headLen, headW };
  let hub = "";
  const hues = [
    [0.0, 0.2],
    [0.33, 0.55],
    [0.67, 1.0],
  ]; // matches conic ring at 0°, 120°, 240°
  let defs = "",
    body = "";
  degs.forEach((d, i) => {
    let fill = ink;
    if (paint === "rainbow") {
      const id = `${idp}a${i}`;
      defs += linGrad(id, polar(c, g.r0, d), polar(c, L, d), ...hues[i]);
      fill = `url(#${id})`;
    }
    body += `<path d="${arrowPath(c, d, g)}" fill="${fill}" stroke="${fill}" stroke-width="${round}" stroke-linejoin="round"/>`;
  });
  if (paint === "rainbow") {
    hub += conicRing(c, hubR, hubW);
    if (innerR) {
      defs += linGrad(`${idp}in`, [c[0] - innerR, c[1]], [c[0] + innerR, c[1]], 0, 1, 8);
      hub += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${innerR}" fill="none" stroke="url(#${idp}in)" stroke-width="${innerW}"/>`;
    }
  } else {
    hub += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${hubR}" fill="none" stroke="${ink}" stroke-width="${hubW}"/>`;
    if (innerR)
      hub += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${innerR}" fill="none" stroke="${ink}" stroke-width="${innerW}"/>`;
  }
  return (defs ? `<defs>${defs}</defs>` : "") + body + hub;
}

const svg = (vb, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="AXIS"><title>AXIS</title>${body}</svg>\n`;

const BASE = {
  L: 120,
  hubR: 26,
  hubW: 12,
  innerR: 8.5,
  innerW: 6.5,
  w0: 24,
  w1: 7,
  headLen: 40,
  headW: 46,
};
const INK_L = "#15161f",
  INK_D = "#f4f5f9";
const files = {};

files["axis-tripod.svg"] = svg("0 0 256 256", tripod(BASE));
files["axis-tripod-a.svg"] = svg("0 0 256 256", tripod({ ...BASE, legDeg: 148, L: 112 }));
files["axis-tripod-mono-light.svg"] = svg(
  "0 0 256 256",
  tripod({ ...BASE, paint: "ink", ink: INK_L }),
);
files["axis-tripod-mono-dark.svg"] = svg(
  "0 0 256 256",
  tripod({ ...BASE, paint: "ink", ink: INK_D }),
);
// Favicon: fewer, heavier parts so it survives 16 px
files["axis-tripod-glyph.svg"] = svg(
  "0 0 64 64",
  tripod({
    size: 64,
    L: 30,
    hubR: 7.5,
    hubW: 5,
    innerR: 0,
    w0: 8,
    w1: 3,
    headLen: 12,
    headW: 15,
    round: 1.5,
  }),
);
files["axis-tripod-app-icon.svg"] = svg(
  "0 0 512 512",
  `<defs><radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#1d1f35"/><stop offset="1" stop-color="#0b0c16"/></radialGradient></defs>` +
    `<rect width="512" height="512" rx="114" fill="url(#bg)"/>` +
    `<g transform="translate(76 76) scale(1.40625)">${tripod({ ...BASE, idp: "i" })}</g>`,
);

for (const [name, body] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), body);
  console.log(name, body.length, "bytes");
}

// ---- Preview ----------------------------------------------------------------
const uri = (n) => "data:image/svg+xml;base64," + Buffer.from(files[n]).toString("base64");
const names = Object.keys(files);
const onLight = names.filter((n) => !n.endsWith("-dark.svg"));
const onDark = names.filter((n) => !n.endsWith("-light.svg"));
const card = (n, bg, fg) =>
  `<figure style="background:${bg};color:${fg}"><img src="${uri(n)}" width="150" height="150" alt=""><figcaption>${n}</figcaption></figure>`;
const sizes = (n, bg) =>
  `<div class="sizes" style="background:${bg}">${[64, 32, 24, 16].map((s) => `<img src="${uri(n)}" width="${s}" height="${s}">`).join("")}</div>`;
fs.writeFileSync(
  path.join(OUT, "preview.html"),
  `<!doctype html><meta charset="utf-8"><title>AXIS logos</title>
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
<h2>Small sizes: glyph · tripod · app icon</h2>
<div class="row">${sizes("axis-tripod-glyph.svg", "#fff")}${sizes("axis-tripod-glyph.svg", "#101118")}${sizes("axis-tripod.svg", "#fff")}${sizes("axis-tripod-app-icon.svg", "#101118")}</div>`,
);
console.log("preview.html");
