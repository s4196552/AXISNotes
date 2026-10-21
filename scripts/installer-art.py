"""Makes the Windows installer's artwork (T-119) from the app icon and the dark palette.

    python scripts/installer-art.py

Writes src-tauri/installer/sidebar.bmp (164x314, the welcome and finish pages) and
header.bmp (150x57, the top of the other pages), which tauri.conf.json points the NSIS
installer at. Needs Pillow (a development tool only; nothing here ships in the app).
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri" / "icons" / "icon.png"
OUT = ROOT / "src-tauri" / "installer"

# The dark theme's tokens (src/styles/theme.css).
BG = (28, 29, 33)  # --bg
BG_SIDEBAR = (22, 23, 26)  # --bg-sidebar
FG = (228, 229, 233)  # --fg
FG_MUTED = (141, 145, 153)  # --fg-muted
ACCENT = (138, 147, 255)  # --accent

FONTS = Path("C:/Windows/Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.load_default(size)


def backdrop(w: int, h: int, glow_at: tuple[int, int], glow_r: int) -> Image.Image:
    """The window background: a soft vertical fade with an accent glow behind the logo."""
    img = Image.new("RGB", (w, h), BG)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        row = tuple(round(BG_SIDEBAR[i] + (BG[i] - BG_SIDEBAR[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse(
        (glow_at[0] - glow_r, glow_at[1] - glow_r, glow_at[0] + glow_r, glow_at[1] + glow_r),
        fill=70,
    )
    glow = glow.filter(ImageFilter.GaussianBlur(glow_r / 2))
    return Image.composite(Image.new("RGB", (w, h), ACCENT), img, glow)


def logo(size: int) -> Image.Image:
    return Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)


def centered_text(draw: ImageDraw.ImageDraw, w: int, y: int, text: str, f, fill) -> None:
    left, _, right, _ = draw.textbbox((0, 0), text, font=f)
    draw.text(((w - (right - left)) / 2 - left, y), text, font=f, fill=fill)


def sidebar() -> Image.Image:
    w, h = 164, 314
    img = backdrop(w, h, (w // 2, 96), 70)
    mark = logo(84)
    img.paste(mark, ((w - 84) // 2, 54), mark)
    draw = ImageDraw.Draw(img)
    centered_text(draw, w, 152, "AXISNotes", font("seguisb.ttf", 21), FG)
    centered_text(draw, w, 182, "Your notes, your files", font("segoeui.ttf", 11), FG_MUTED)
    # A thin accent rule at the foot.
    draw.rectangle((w // 2 - 18, h - 30, w // 2 + 18, h - 29), fill=ACCENT)
    return img


def header() -> Image.Image:
    w, h = 150, 57
    img = backdrop(w, h, (30, h // 2), 26)
    mark = logo(38)
    img.paste(mark, (12, (h - 38) // 2), mark)
    draw = ImageDraw.Draw(img)
    draw.text((56, 17), "AXISNotes", font=font("seguisb.ttf", 15), fill=FG)
    return img


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    sidebar().save(OUT / "sidebar.bmp")
    header().save(OUT / "header.bmp")
    print(f"Wrote {OUT / 'sidebar.bmp'} and {OUT / 'header.bmp'}")
