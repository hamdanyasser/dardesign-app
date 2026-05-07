"""Helpers shared by sweep / ablate / baseline / metrics scripts."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


def list_room_images(rooms_dir: Path, limit: int | None = None) -> list[Path]:
    rooms = sorted(
        p for p in rooms_dir.glob("*")
        if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
    )
    if limit is not None:
        rooms = rooms[:limit]
    return rooms


def _font(size: int = 24) -> ImageFont.ImageFont:
    for candidate in ("arial.ttf", "DejaVuSans.ttf", "Helvetica.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make_contact_sheet(
    cells: list[tuple[Image.Image, str]],
    *,
    cols: int,
    cell_size: tuple[int, int] = (512, 512),
    title: str | None = None,
    title_height: int = 56,
    label_height: int = 36,
    bg: tuple[int, int, int] = (16, 17, 26),
    fg: tuple[int, int, int] = (212, 175, 55),
) -> Image.Image:
    """Build a labelled grid. `cells` is [(image, caption)]."""
    rows = (len(cells) + cols - 1) // cols
    cw, ch = cell_size
    width = cols * cw
    height = (title_height if title else 0) + rows * (ch + label_height)
    sheet = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(sheet)

    if title:
        font_t = _font(28)
        draw.text((16, (title_height - 28) // 2), title, fill=fg, font=font_t)

    font_l = _font(18)
    y0 = title_height if title else 0
    for idx, (img, caption) in enumerate(cells):
        r, c = divmod(idx, cols)
        x = c * cw
        y = y0 + r * (ch + label_height)
        thumb = img.convert("RGB").resize(cell_size)
        sheet.paste(thumb, (x, y))
        # caption strip
        draw.rectangle([x, y + ch, x + cw, y + ch + label_height], fill=(20, 17, 10))
        draw.text((x + 8, y + ch + 6), caption[:80], fill=fg, font=font_l)
    return sheet


def write_pdf(images: Iterable[Image.Image], out_path: Path) -> Path:
    imgs = [im.convert("RGB") for im in images]
    if not imgs:
        raise ValueError("write_pdf: no images to write")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    imgs[0].save(out_path, "PDF", save_all=True, append_images=imgs[1:])
    return out_path
