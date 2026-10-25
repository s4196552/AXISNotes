# AXIS compass concepts (256 grid). Ink shapes plus one Signal accent, as in the kits.
import math, sys

INK, SIGNAL = "#16181D", "#E4472B"
v = sys.argv[1] if len(sys.argv) > 1 else "v1"
f = lambda n: f"{n:.2f}".rstrip("0").rstrip(".")
pt = lambda p: f"{f(p[0])} {f(p[1])}"
poly = lambda pts: "M" + " L".join(pt(p) for p in pts) + " Z"
circle = lambda cx, cy, r: f"M{f(cx-r)} {f(cy)} a{f(r)} {f(r)} 0 1 0 {f(2*r)} 0 a{f(r)} {f(r)} 0 1 0 {f(-2*r)} 0 Z"


def write(name, title, parts):
    EO = ' fill-rule="evenodd"'
    body = "".join(
        f'<path fill="{SIGNAL if role == "signal" else INK}"{EO if eo else ""} d="{d}"/>'
        for d, role, eo in parts)
    open(f"{name}-{v}.svg", "w", encoding="utf-8").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>{title}</title>{body}</svg>\n')


def offset_line(p, q, d):
    """Line p→q shifted d to its left (screen coords)."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    n = math.hypot(dx, dy)
    ox, oy = dy / n * d, -dx / n * d
    return (p[0] + ox, p[1] + oy), (q[0] + ox, q[1] + oy)


def intersect(a1, a2, b1, b2):
    d = (a1[0] - a2[0]) * (b1[1] - b2[1]) - (a1[1] - a2[1]) * (b1[0] - b2[0])
    t = ((a1[0] - b1[0]) * (b1[1] - b2[1]) - (a1[1] - b1[1]) * (b1[0] - b2[0])) / d
    return (a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1]))


# 1. North A: a compass needle whose north half is the A (open counter), south half solid;
#    the pivot is the Signal point.
def north_a(top=20, pivot=156, bottom=236, hw=60, w=30, r=19):
    N, L, R, S = (128, top), (128 - hw, pivot), (128 + hw, pivot), (128, bottom)
    # inner counter of the north half: edges offset inward by w, closed by the pivot line
    l1, l2 = offset_line(L, N, -w)      # left edge shifted right (inward)
    r1, r2 = offset_line(N, R, -w)      # right edge shifted left (inward)
    apex_in = intersect(l1, l2, r1, r2)
    base_y = pivot - 0.0
    li = intersect(l1, l2, (0, base_y), (256, base_y))
    ri = intersect(r1, r2, (0, base_y), (256, base_y))
    north = poly([L, N, R, ri, apex_in, li])            # the A: outline with an open bottom
    # The south half tucks 2 units under the north half, so no seam shows where they meet.
    south = poly([(L[0] + 2 * hw / (bottom - pivot) * 0, pivot - 2), (R[0], pivot - 2), R, S, L])
    return [(north, "ink", False), (south, "ink", False), (circle(128, pivot, r), "signal", False)]


# 2. Axis rose: two sharpened axes crossing; the north half in Signal; a round point cut out of
#    the centre (a real hole through both colours).
def axis_rose(n_tip=16, arm=96, hw=96 * math.tan(math.radians(15)), hole=12):
    c = 128
    # where the E-W diamond's lower edges meet the south point's edges
    # solve y = c + (c+arm-x)*hw/arm  and  x = c+hw - (y-c)*hw/arm  on the right side
    k = hw / arm
    ty = (arm - hw) * k / (1 - k * k)            # y - c at the meeting point
    tx = c + hw - ty * k
    ink = poly([(c - arm, c), (c, c - hw), (c + arm, c), (tx, c + ty), (c, c + arm), (2 * c - tx, c + ty)])
    ink += " " + circle(c, c, hole)
    north = (f"M{c} {n_tip} L{c+hw} {c} L{c+hole} {c} A{hole} {hole} 0 0 0 {c-hole} {c} "
             f"L{c-hw} {c} Z")
    return [(ink, "ink", True), (north, "signal", False)]


# 3. Drafting A: a drafting compass. Hinge at the top, two tapering legs, and a crossbar that is
#    an arc centred on the hinge (the curve a compass draws).
def drafting_a(hinge=(128, 56), tip_l=(128 - 174 * math.tan(math.radians(20)), 230), tip_r=(128 + 174 * math.tan(math.radians(20)), 230), leg=28, hr=24, arc_r=(116, 134)):
    hx, hy = hinge
    parts = []
    for tip in (tip_l, tip_r):
        dx, dy = tip[0] - hx, tip[1] - hy
        n = math.hypot(dx, dy)
        px, py = -dy / n * leg / 2, dx / n * leg / 2
        parts.append((poly([(hx + px, hy + py), (hx - px, hy - py), tip]), "ink", False))
    # handle above the hinge
    parts.append((f"M{hx-9} {hy} L{hx-9} {24} A9 9 0 0 1 {hx+9} 24 L{hx+9} {hy} Z", "ink", False))
    parts.append((circle(hx, hy, hr), "ink", False))
    # arc between the legs' centre lines
    a_l = math.degrees(math.atan2(tip_l[1] - hy, tip_l[0] - hx))
    a_r = math.degrees(math.atan2(tip_r[1] - hy, tip_r[0] - hx))
    P = lambda rad, a: (hx + rad * math.cos(math.radians(a)), hy + rad * math.sin(math.radians(a)))
    R, r = arc_r[1], arc_r[0]
    arc = (f"M{pt(P(R, a_r))} A{R} {R} 0 0 1 {pt(P(R, a_l))} L{pt(P(r, a_l))} "
           f"A{r} {r} 0 0 0 {pt(P(r, a_r))} Z")
    parts.append((arc, "signal", False))
    return parts


write("d-north-a", "AXIS: North A", north_a())
write("f-drafting-a", "AXIS: Drafting A", drafting_a())
rose = axis_rose()
write("e-axis-rose", "AXIS: Axis rose", rose)

if v == "v3":
    write("d-north-a", "AXIS: North A", north_a(top=14, pivot=150, bottom=242, hw=46, w=24, r=16))
    write("e-axis-rose", "AXIS: Axis rose", axis_rose(n_tip=32))
    # legs: choose the centre-line angle so the outer edge of each tapering leg is exactly 15° off vertical
    def outer_angle(a, leg=28, hy=56, ty=230):
        tip = (128 + (ty - hy) * math.tan(math.radians(a)), ty)
        dx, dy = tip[0] - 128, tip[1] - hy
        n = math.hypot(dx, dy)
        top = (128 + dy / n * leg / 2, hy - dx / n * leg / 2)    # the outer side of the hinge end
        return math.degrees(math.atan2(tip[0] - top[0], tip[1] - top[1])), tip
    lo, hi = 15.0, 25.0
    for _ in range(60):
        mid = (lo + hi) / 2
        ang, _ = outer_angle(mid)
        lo, hi = (mid, hi) if ang < 15 else (lo, mid)
    _, tr = outer_angle(lo)
    tl = (256 - tr[0], tr[1])
    write("f-drafting-a", "AXIS: Drafting A", drafting_a(tip_l=tl, tip_r=tr))
    print("leg centre angle", round(lo, 2))
