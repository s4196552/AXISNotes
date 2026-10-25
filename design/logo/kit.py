# AXIS logo kits for concepts A (Lambda A), B (Origin), C (Own axis).
# Everything is computed geometry: symbols on a 256 grid, a constructed wordmark, lockups.
import math, os

INK, SIGNAL, WHITE = "#16181D", "#E4472B", "#FFFFFF"
f = lambda n: f"{n:.2f}".rstrip("0").rstrip(".")
pt = lambda p: f"{f(p[0])} {f(p[1])}"
poly = lambda pts: "M" + " L".join(pt(p) for p in pts) + " Z"
circle = lambda cx, cy, r: f"M{f(cx-r)} {f(cy)} a{f(r)} {f(r)} 0 1 0 {f(2*r)} 0 a{f(r)} {f(r)} 0 1 0 {f(-2*r)} 0 Z"


# ---------- symbols: list of (d, role) where role is "ink" or "signal" ----------
def sym_lambda(half=26, w=36, top=28, base=226, r=22, doty=186):
    a = math.radians(half)
    ho = (base - top) * math.tan(a)
    iy = top + w / math.sin(a)
    hi = (base - iy) * math.tan(a)
    legs = poly([(128 - ho, base), (128, top), (128 + ho, base), (128 + hi, base), (128, iy), (128 - hi, base)])
    return [(legs, "ink"), (circle(128, doty, r), "signal")]


def sym_origin(w=36, ox=84, oy=172, stub=30, top=36, right=222, r=28, px=170, py=84):
    h = w / 2
    v = f"M{f(ox-h)} {oy+h+stub} L{f(ox-h)} {top+h} A{h} {h} 0 0 1 {f(ox+h)} {top+h} L{f(ox+h)} {oy+h+stub} Z"
    hz = f"M{f(ox-h-stub)} {oy-h} L{right-h} {oy-h} A{h} {h} 0 0 1 {right-h} {oy+h} L{f(ox-h-stub)} {oy+h} Z"
    return [(v, "ink"), (hz, "ink"), (circle(px, py, r), "signal")]


def sym_axis(tilt=23.4, ro=84, ri=50, bw=28, gap=12, half=118, cx=128, cy=128):
    t = math.radians(tilt)
    u, n = (math.sin(t), -math.cos(t)), (math.cos(t), math.sin(t))
    P = lambda a, b: (cx + a * u[0] + b * n[0], cy + a * u[1] + b * n[1])
    c = bw / 2 + gap
    out = []
    for side in (1, -1):
        to, ti = math.sqrt(ro * ro - c * c), math.sqrt(ri * ri - c * c)
        a, b, e, g = P(to, side * c), P(-to, side * c), P(-ti, side * c), P(ti, side * c)
        sw = 1 if side == 1 else 0
        out.append((f"M{pt(a)} A{ro} {ro} 0 0 {sw} {pt(b)} L{pt(e)} A{ri} {ri} 0 0 {1-sw} {pt(g)} Z", "ink"))
    r = bw / 2
    p1, p2, p3, p4 = P(half - r, r), P(-(half - r), r), P(-(half - r), -r), P(half - r, -r)
    out.append((f"M{pt(p4)} A{r} {r} 0 0 1 {pt(p1)} L{pt(p2)} A{r} {r} 0 0 1 {pt(p3)} Z", "signal"))
    return out


# Small-size cuts: heavier strokes, bigger point, wider gaps (used for favicons and app icons).
SMALL = {
    "a": lambda: sym_lambda(w=44, r=26, doty=190),
    "b": lambda: sym_origin(w=46, stub=22, r=34, px=168, py=84, ox=86, oy=168),
    "c": lambda: sym_axis(ro=90, ri=48, bw=36, gap=16, half=120),
}


# ---------- wordmark "AXIS": cap height 168, stroke 26, baseline 212 ----------
H, W, TOP, BASE = 168, 26, 44, 212


def wm_A(x, dot):
    half = math.radians(22)
    ho = H * math.tan(half)
    iy = TOP + W / math.sin(half)
    hi = (BASE - iy) * math.tan(half)
    cx = x + ho
    parts = [(poly([(cx - ho, BASE), (cx, TOP), (cx + ho, BASE), (cx + hi, BASE), (cx, iy), (cx - hi, BASE)]), "ink")]
    if dot:
        parts.append((circle(cx, 184, 15), "signal"))
    else:  # a crossbar spanning the counter
        y0, y1 = 150, 172
        xl = lambda y: cx - (y - iy) * math.tan(half)
        parts.append((poly([(xl(y0) - 1, y0), (2 * cx - xl(y0) + 1, y0), (2 * cx - xl(y1) + 1, y1), (xl(y1) - 1, y1)]), "ink"))
    return parts, 2 * ho


def wm_X(x):
    # Strokes at exactly 60° from the baseline (30° from vertical).
    a = math.radians(30)
    hx = W / math.cos(a)
    width = H * math.tan(a) + hx
    s1 = poly([(x, TOP), (x + hx, TOP), (x + width, BASE), (x + width - hx, BASE)])
    s2 = poly([(x + width - hx, TOP), (x + width, TOP), (x + hx, BASE), (x, BASE)])
    return [(s1, "ink"), (s2, "ink")], width


def wm_I(x):
    return [(poly([(x, TOP), (x + W, TOP), (x + W, BASE), (x, BASE)]), "ink")], W


def sector(cx, cy, R, r, a0, a1, sweep):
    P = lambda rad, a: (cx + rad * math.cos(math.radians(a)), cy + rad * math.sin(math.radians(a)))
    large = 1 if abs(a1 - a0) > 180 else 0
    return (f"M{pt(P(R, a0))} A{f(R)} {f(R)} 0 {large} {sweep} {pt(P(R, a1))} L{pt(P(r, a1))} "
            f"A{f(r)} {f(r)} 0 {large} {1-sweep} {pt(P(r, a0))} Z")


def wm_S(x):
    R = (H + W) / 4
    cx = x + R
    up = sector(cx, TOP + R, R, R - W, -35, -270, 0)             # over the top to the spine
    lo = sector(cx, TOP + 3 * R - W, R, R - W, -90, 145, 1)       # from the spine round to the lower-left terminal
    y0 = TOP + 2 * R - W                                          # the shared spine band; a small patch hides the seam
    seam = poly([(cx - 2, y0), (cx + 2, y0), (cx + 2, y0 + W), (cx - 2, y0 + W)])
    return [(up, "ink"), (lo, "ink"), (seam, "ink")], 2 * R


def wordmark(dot_a):
    parts, x = [], 0.0
    p, wd = wm_A(x, dot_a); parts += p; x += wd + 12
    p, wd = wm_X(x); parts += p; x += wd + 30
    p, wd = wm_I(x); parts += p; x += wd + 32
    p, wd = wm_S(x); parts += p; x += wd
    return parts, x


# ---------- writing SVGs ----------
def paint(role, reversed_):
    return SIGNAL if role == "signal" else (WHITE if reversed_ else INK)


def paths(parts, reversed_=False, tf=""):
    body = "".join(f'<path fill="{paint(r, reversed_)}" d="{d}"/>' for d, r in parts)
    return f'<g transform="{tf}">{body}</g>' if tf else body


def write(path, vb, title, body):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>{title}</title>{body}</svg>\n')


def bbox_x(parts):
    import re
    xs = []
    for d, _ in parts:
        nums = [float(n) for n in re.findall(r"-?\d+\.?\d*", d)]
        # crude: absolute coordinates only in our paths except circle arcs; good enough for right edge
        xs += nums[0::2]
    return max(xs)


CONCEPTS = {
    "a-lambda": ("AXIS logo, Lambda A", sym_lambda, "a", True, 226),
    "b-origin": ("AXIS logo, Origin", sym_origin, "b", False, 222),
    "c-own-axis": ("AXIS logo, Own axis", sym_axis, "c", False, 216),
}

for name, (title, fn, key, dot_a, right) in CONCEPTS.items():
    os.makedirs(f"kit/{name}", exist_ok=True)
    sym = fn()
    base = f"kit/{name}/axis-{name}"
    for rev, suffix in ((False, ""), (True, "-reversed")):
        write(f"{base}-symbol{suffix}.svg", "0 0 256 256", title, paths(sym, rev))
        write(f"{base}-symbol-small{suffix}.svg", "0 0 256 256", title + " (small sizes)", paths(SMALL[key](), rev))
    wm, ww = wordmark(dot_a)
    # wordmark only (height 256 box, cap 168)
    write(f"{base}-wordmark.svg", f"-24 0 {f(ww + 48)} 256", title, paths(wm))
    write(f"{base}-wordmark-reversed.svg", f"-24 0 {f(ww + 48)} 256", title, paths(wm, True))
    # horizontal lockup: symbol 256 high, wordmark cap = 0.42 of it, centred on the symbol's middle
    s = 108 / H
    wx = right + 44
    ty = 128 - (TOP + H / 2) * s
    total = wx + ww * s + 28
    for rev, suffix in ((False, ""), (True, "-reversed")):
        body = paths(sym, rev) + paths(wm, rev, f"translate({f(wx)} {f(ty)}) scale({f(s)})")
        write(f"{base}-horizontal{suffix}.svg", f"0 0 {f(total)} 256", title, body)
    # stacked lockup: symbol on top, wordmark below (cap = 0.34 of the symbol box)
    s2 = 88 / H
    width = max(256, ww * s2 + 48)
    sx = (width - 256) / 2
    wy = 256 + 26 - TOP * s2
    height = 256 + 26 + H * s2 + 40
    for rev, suffix in ((False, ""), (True, "-reversed")):
        body = paths(sym, rev, f"translate({f(sx)} 0)") + paths(
            wm, rev, f"translate({f((width - ww * s2) / 2)} {f(wy)}) scale({f(s2)})")
        write(f"{base}-stacked{suffix}.svg", f"0 0 {f(width)} {f(height)}", title, body)
print("ok")
