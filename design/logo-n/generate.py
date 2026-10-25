"""Generate AXISNotes tile-star + n logo concepts as clean SVG paths."""
import math, sys, os

OUT = sys.argv[1]
B = 256.0  # block size

# Current AXISNotes star (src/assets/logo.svg), local coords
C1 = [(68.5, 2), (68.5, 56), (91, 80), (135, 113)]   # top -> right cusp
C2 = [(135, 113), (91, 80), (46, 80), (2, 113)]      # right cusp -> left cusp (bottom side)
C3 = [(2, 113), (46, 80), (68.5, 56), (68.5, 2)]     # left cusp -> top

def bez(c, t):
    a, b, cc, d = c
    mt = 1 - t
    return (mt**3*a[0] + 3*mt*mt*t*b[0] + 3*mt*t*t*cc[0] + t**3*d[0],
            mt**3*a[1] + 3*mt*mt*t*b[1] + 3*mt*t*t*cc[1] + t**3*d[1])

def lerp(p, q, t): return (p[0] + (q[0]-p[0])*t, p[1] + (q[1]-p[1])*t)

def split(c, t):
    a, b, cc, d = c
    ab, bc, cd = lerp(a, b, t), lerp(b, cc, t), lerp(cc, d, t)
    abc, bcd = lerp(ab, bc, t), lerp(bc, cd, t)
    m = lerp(abc, bcd, t)
    return [a, ab, abc, m], [m, bcd, cd, d]

def sub(c, t0, t1):
    _, right = split(c, t0)
    left, _ = split(right, (t1 - t0) / (1 - t0))
    return left

def rev(c): return c[::-1]

def solve(f, lo, hi):
    flo = f(lo)
    for _ in range(80):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm > 0) == (flo > 0): lo, flo = mid, fm
        else: hi = mid
    return (lo + hi) / 2

def fmt(p): return f"{p[0]:.2f} {p[1]:.2f}"

def tiles(s, top, g):
    """Square block cut into 3 tiles by the star (scale s, top cusp at y=top) plus gutters of width g."""
    ox, oy = B/2 - s*68.5, top - s*2
    T = lambda p: (ox + s*p[0], oy + s*p[1])
    c1, c2, c3 = ([T(p) for p in c] for c in (C1, C2, C3))
    cx = B/2
    # top gutter: x = cx +- g/2
    t1a = solve(lambda t: bez(c1, t)[0] - (cx + g/2), 0.0001, 0.5)
    t3b = solve(lambda t: bez(c3, t)[0] - (cx - g/2), 0.5, 0.9999)
    # lower cusps: tangent axes
    R, L = c1[3], c3[0]
    dR = (0.8, 0.6); nR = (-0.6, 0.8)
    dL = (-0.8, 0.6); nL = (0.6, 0.8)
    distR = lambda p: (p[0]-R[0])*nR[0] + (p[1]-R[1])*nR[1]
    distL = lambda p: (p[0]-L[0])*nL[0] + (p[1]-L[1])*nL[1]
    t1b = solve(lambda t: distR(bez(c1, t)) + g/2, 0.5, 0.9999)   # upper edge (negative side)
    t2a = solve(lambda t: distR(bez(c2, t)) - g/2, 0.0001, 0.5)   # lower edge
    # left cusp: C3 is on the side with... determine by sign
    sgn3 = 1 if distL(bez(c3, 0.3)) > 0 else -1
    t3a = solve(lambda t: distL(bez(c3, t)) - sgn3*g/2, 0.0001, 0.5)
    t2b = solve(lambda t: distL(bez(c2, t)) + sgn3*g/2, 0.5, 0.9999)
    # gutter edge lines hitting the block edge
    def edge_hit(cusp, d, n, off, side_x):
        o = (cusp[0] + n[0]*off, cusp[1] + n[1]*off)
        u = (side_x - o[0]) / d[0]
        return (side_x, o[1] + d[1]*u)
    pR_up = edge_hit(R, dR, nR, -g/2, B)
    pR_dn = edge_hit(R, dR, nR, +g/2, B)
    pL_up = edge_hit(L, dL, nL, -sgn3*g/2 * 1, 0) if False else None
    # left gutter: C3 side offset sgn3*g/2, C2 side -sgn3*g/2
    pL_c3 = edge_hit(L, dL, nL, sgn3*g/2, 0)
    pL_c2 = edge_hit(L, dL, nL, -sgn3*g/2, 0)

    def cpath(c): return f"C{fmt(c[1])} {fmt(c[2])} {fmt(c[3])}"
    # top-right tile
    a = sub(c1, t1a, t1b)
    tr = (f"M{fmt((cx+g/2, 0))}H{B:.2f}V{pR_up[1]:.2f}L{fmt(a[3])}" + cpath(rev(a)) + "Z")
    # top-left tile
    b = sub(c3, t3a, t3b)
    tl = (f"M0 0H{cx-g/2:.2f}V{b[3][1]:.2f}" + cpath(rev(b)) + f"L{fmt(pL_c3)}Z")
    # bottom tile
    c = sub(c2, t2a, t2b)
    bt = (f"M{fmt(pL_c2)}L{fmt(c[3])}" + cpath(rev(c)) + f"L{fmt(pR_dn)}V{B:.2f}H0Z")
    return [tl, tr, bt], (pR_up, pR_dn, pL_c3, pL_c2)

K = 0.5522847498
def n_path(x0, H, W, t, y0=0.0, slant=0.0, base=None):
    """Geometric n: square top-left, round shoulder, round counter. Optional italic slant (deg)."""
    base = H + y0 if base is None else base
    k = math.tan(math.radians(slant))
    S = lambda p: (p[0] + k*(base - p[1]), p[1])
    R = W/2; r = R - t
    cxs, cys = x0 + W/2, y0 + R
    pts = []
    # outer
    seg = []
    seg.append(("M", [(x0, y0 + H)]))
    seg.append(("L", [(x0, y0)]))
    seg.append(("L", [(cxs, y0)]))
    seg.append(("C", [(cxs + K*R, y0), (x0 + W, cys - K*R), (x0 + W, cys)]))
    seg.append(("L", [(x0 + W, y0 + H)]))
    seg.append(("L", [(x0 + W - t, y0 + H)]))
    seg.append(("L", [(x0 + W - t, cys)]))
    seg.append(("C", [(x0 + W - t, cys - K*r), (cxs + K*r, cys - r), (cxs, cys - r)]))
    seg.append(("C", [(cxs - K*r, cys - r), (x0 + t, cys - K*r), (x0 + t, cys)]))
    seg.append(("L", [(x0 + t, y0 + H)]))
    out = ""
    for cmd, ps in seg:
        out += cmd + " ".join(fmt(S(p)) for p in ps)
    return out + "Z"

def svg(paths, w, h, title):
    body = "".join(f'<path d="{d}"/>' for d in paths)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}">'
            f'<title>{title}</title><g fill="#000">{body}</g></svg>\n')

def write(name, paths, w, h, title):
    with open(os.path.join(OUT, name), "w") as f: f.write(svg(paths, w, h, title))

S_, TOP, G = float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
NG = float(sys.argv[5]) if len(sys.argv) > 5 else G
blk, info = tiles(S_, TOP, G)
print("edge hits", info)
write("star-block.svg", blk, B, B, "AXISNotes star block")

# A: upright n, full height, beside block at gutter
W, t = 196, 64
write("a-lockup.svg", blk + [n_path(B + NG, B, W, t)], B + NG + W, B, "AXISNotes A")
# B: italic n, full height
sl = 12; k = math.tan(math.radians(sl))
gap = NG
nb = n_path(B + gap, B, W, t, slant=sl)
write("b-lockup.svg", blk + [nb], B + gap + W + k*(B - W/2) + 3, B, "AXISNotes B")
# C: n at lower 2/3 height (x-height), sitting on baseline
h2, w2, t2 = 172, 150, 50
write("c-lockup.svg", blk + [n_path(B + NG, h2, w2, t2, y0=B - h2)], B + NG + w2, B, "AXISNotes C")

# ---- In-square version: bottom tile split by a centre gutter; bottom-right piece becomes the n ----
def mark_with_n(s, top, g, stem, counter, arch):
    ox, oy = B/2 - s*68.5, top - s*2
    T = lambda p: (ox + s*p[0], oy + s*p[1])
    c1, c2, c3 = ([T(p) for p in c] for c in (C1, C2, C3))
    cx = B/2
    t1a = solve(lambda t: bez(c1, t)[0] - (cx + g/2), 0.0001, 0.5)
    t3b = solve(lambda t: bez(c3, t)[0] - (cx - g/2), 0.5, 0.9999)
    R, L = c1[3], c3[0]
    dR, nR, dL, nL = (0.8, 0.6), (-0.6, 0.8), (-0.8, 0.6), (0.6, 0.8)
    distR = lambda p: (p[0]-R[0])*nR[0] + (p[1]-R[1])*nR[1]
    distL = lambda p: (p[0]-L[0])*nL[0] + (p[1]-L[1])*nL[1]
    t1b = solve(lambda t: distR(bez(c1, t)) + g/2, 0.5, 0.9999)
    t2a = solve(lambda t: distR(bez(c2, t)) - g/2, 0.0001, 0.5)
    sgn3 = 1 if distL(bez(c3, 0.3)) > 0 else -1
    t3a = solve(lambda t: distL(bez(c3, t)) - sgn3*g/2, 0.0001, 0.5)
    t2b = solve(lambda t: distL(bez(c2, t)) + sgn3*g/2, 0.5, 0.9999)
    def hit(cusp, d, n, off, side_x):
        o = (cusp[0] + n[0]*off, cusp[1] + n[1]*off)
        return (side_x, o[1] + d[1]*(side_x - o[0])/d[0])
    pR_up, pR_dn = hit(R, dR, nR, -g/2, B), hit(R, dR, nR, g/2, B)
    pL_c3, pL_c2 = hit(L, dL, nL, sgn3*g/2, 0), hit(L, dL, nL, -sgn3*g/2, 0)
    # centre gutter splits C2 at x = cx +- g/2  (C2 runs right cusp -> left cusp)
    tmR = solve(lambda t: bez(c2, t)[0] - (cx + g/2), 0.0001, 0.9999)
    tmL = solve(lambda t: bez(c2, t)[0] - (cx - g/2), 0.0001, 0.9999)
    cp = lambda c: f"C{fmt(c[1])} {fmt(c[2])} {fmt(c[3])}"
    a = sub(c1, t1a, t1b)
    tr = f"M{fmt((cx+g/2, 0))}H{B:.2f}V{pR_up[1]:.2f}L{fmt(a[3])}" + cp(rev(a)) + "Z"
    b = sub(c3, t3a, t3b)
    tl = f"M0 0H{cx-g/2:.2f}V{b[3][1]:.2f}" + cp(rev(b)) + f"L{fmt(pL_c3)}Z"
    bl_c = sub(c2, tmL, t2b)
    bl = f"M{cx-g/2:.2f} {B:.2f}V{bl_c[0][1]:.2f}" + cp(bl_c) + f"L{fmt(pL_c2)}V{B:.2f}Z"
    br_c = sub(c2, t2a, tmR)
    # n: the bottom-right tile with a round-topped counter cut from the baseline
    x0 = cx + g/2
    xa, xb = x0 + stem, x0 + stem + counter
    r = counter/2; mx = (xa + xb)/2
    shoulder = bez(c2, solve(lambda t: bez(c2, t)[0] - mx, 0.0001, 0.9999))[1]
    yc = shoulder + arch + r          # centre of the counter's round top
    br = (f"M{x0:.2f} {B:.2f}V{br_c[3][1]:.2f}" + cp(rev(br_c)) + f"L{fmt(pR_dn)}V{B:.2f}"
          f"H{xb:.2f}V{yc:.2f}C{xb:.2f} {yc-K*r:.2f} {mx+K*r:.2f} {yc-r:.2f} {mx:.2f} {yc-r:.2f}"
          f"C{mx-K*r:.2f} {yc-r:.2f} {xa:.2f} {yc-K*r:.2f} {xa:.2f} {yc:.2f}V{B:.2f}Z")
    return [tl, tr, bl, br]

if len(sys.argv) > 6 and sys.argv[6] == "inside":
    pass

# ---- v3: plus-shaped grid meeting at the star; bottom-right cell is a proper n ----
def mark_v3(s, cy, g, stem, counter, arch, rs):
    ox, oy = B/2 - s*68.5, cy - s*113
    T = lambda p: (ox + s*p[0], oy + s*p[1])
    c1, c2, c3 = ([T(p) for p in c] for c in (C1, C2, C3))
    cx = B/2
    Rc, Lc = c1[3], c3[0]
    t1a = solve(lambda t: bez(c1, t)[0] - (cx + g/2), 0.0001, 0.5)
    t1b = solve(lambda t: bez(c1, t)[1] - (cy - g), 0.5, 0.9999)
    t3b = solve(lambda t: bez(c3, t)[0] - (cx - g/2), 0.5, 0.9999)
    t3a = solve(lambda t: bez(c3, t)[1] - (cy - g), 0.0001, 0.5)
    tmR = solve(lambda t: bez(c2, t)[0] - (cx + g/2), 0.0001, 0.9999)
    tmL = solve(lambda t: bez(c2, t)[0] - (cx - g/2), 0.0001, 0.9999)
    cp = lambda c: f"C{fmt(c[1])} {fmt(c[2])} {fmt(c[3])}"
    b = sub(c3, t3a, t3b)
    tl = f"M0 0H{cx-g/2:.2f}V{b[3][1]:.2f}" + cp(rev(b)) + f"H0Z"
    a = sub(c1, t1a, t1b)
    tr = f"M{cx+g/2:.2f} 0H{B:.2f}V{cy-g:.2f}H{a[3][0]:.2f}" + cp(rev(a)) + "Z"
    blc = sub(c2, tmL, 0.99999)
    bl = f"M{cx-g/2:.2f} {B:.2f}V{blc[0][1]:.2f}" + cp(blc) + f"H0V{B:.2f}Z"
    brc = sub(c2, 0.00001, tmR)
    x0 = cx + g/2
    xa, xb = x0 + stem, x0 + stem + counter
    r = counter/2; mx = (xa + xb)/2
    top_at_mx = bez(c2, solve(lambda t: bez(c2, t)[0] - mx, 0.0001, 0.9999))[1]
    yc = top_at_mx + arch + r
    k = K*rs
    br = (f"M{x0:.2f} {B:.2f}V{brc[3][1]:.2f}" + cp(rev(brc)) +
          f"H{B-rs:.2f}C{B-rs+k:.2f} {cy:.2f} {B:.2f} {cy+rs-k:.2f} {B:.2f} {cy+rs:.2f}V{B:.2f}"
          f"H{xb:.2f}V{yc:.2f}C{xb:.2f} {yc-K*r:.2f} {mx+K*r:.2f} {yc-r:.2f} {mx:.2f} {yc-r:.2f}"
          f"C{mx-K*r:.2f} {yc-r:.2f} {xa:.2f} {yc-K*r:.2f} {xa:.2f} {yc:.2f}V{B:.2f}Z")
    return [tl, tr, bl, br]
