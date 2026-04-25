#!/usr/bin/env python3
"""Generate Still Point logo concepts and production app/web assets.

The script intentionally uses only the Python standard library so the assets can
be regenerated in minimal CI or agent environments.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


Color = tuple[int, int, int, int]
PixelBuffer = list[bytearray]


def clamp(value: float, low: int = 0, high: int = 255) -> int:
    return max(low, min(high, int(round(value))))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(clamp(a[i] + (b[i] - a[i]) * t) for i in range(3))


def blend(canvas: PixelBuffer, x: int, y: int, color: Color) -> None:
    if y < 0 or y >= len(canvas) or x < 0 or x >= len(canvas[0]) // 4:
        return

    alpha = color[3] / 255
    if alpha <= 0:
        return

    row = canvas[y]
    i = x * 4
    inv = 1 - alpha
    row[i] = clamp(color[0] * alpha + row[i] * inv)
    row[i + 1] = clamp(color[1] * alpha + row[i + 1] * inv)
    row[i + 2] = clamp(color[2] * alpha + row[i + 2] * inv)
    row[i + 3] = 255


def make_canvas(size: int) -> PixelBuffer:
    canvas: PixelBuffer = []
    inner = (26, 24, 22)
    outer = (8, 12, 12)
    glow = (25, 60, 36)
    for y in range(size):
        row = bytearray(size * 4)
        ny = (y / (size - 1)) * 2 - 1
        for x in range(size):
            nx = (x / (size - 1)) * 2 - 1
            dist = min(1, math.sqrt(nx * nx + ny * ny))
            base = mix(inner, outer, dist * 0.78)
            green_lift = max(0, 1 - math.sqrt((nx + 0.12) ** 2 + (ny - 0.16) ** 2) / 0.95)
            rgb = mix(base, glow, green_lift * 0.28)
            i = x * 4
            row[i : i + 4] = bytes((*rgb, 255))
        canvas.append(row)
    return canvas


def make_canvas_rect(width: int, height: int) -> PixelBuffer:
    canvas: PixelBuffer = []
    inner = (26, 24, 22)
    outer = (8, 12, 12)
    glow = (25, 60, 36)
    for y in range(height):
        row = bytearray(width * 4)
        ny = (y / (height - 1)) * 2 - 1
        for x in range(width):
            nx = (x / (width - 1)) * 2 - 1
            dist = min(1, math.sqrt(nx * nx + ny * ny))
            base = mix(inner, outer, dist * 0.72)
            green_lift = max(0, 1 - math.sqrt((nx + 0.25) ** 2 + (ny - 0.08) ** 2) / 0.88)
            rgb = mix(base, glow, green_lift * 0.24)
            i = x * 4
            row[i : i + 4] = bytes((*rgb, 255))
        canvas.append(row)
    return canvas


def draw_circle(canvas: PixelBuffer, cx: float, cy: float, radius: float, color: Color) -> None:
    size = len(canvas)
    x0 = max(0, int((cx - radius) * size))
    x1 = min(size - 1, int((cx + radius) * size) + 1)
    y0 = max(0, int((cy - radius) * size))
    y1 = min(size - 1, int((cy + radius) * size) + 1)
    rr = (radius * size) ** 2
    ccx = cx * size
    ccy = cy * size
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x - ccx) ** 2 + (y - ccy) ** 2 <= rr:
                blend(canvas, x, y, color)


def draw_ring(canvas: PixelBuffer, cx: float, cy: float, radius: float, stroke: float, color: Color) -> None:
    size = len(canvas)
    outer = (radius + stroke / 2) * size
    inner = max(0, (radius - stroke / 2) * size)
    outer2 = outer * outer
    inner2 = inner * inner
    pad = radius + stroke
    x0 = max(0, int((cx - pad) * size))
    x1 = min(size - 1, int((cx + pad) * size) + 1)
    y0 = max(0, int((cy - pad) * size))
    y1 = min(size - 1, int((cy + pad) * size) + 1)
    ccx = cx * size
    ccy = cy * size
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            d2 = (x - ccx) ** 2 + (y - ccy) ** 2
            if inner2 <= d2 <= outer2:
                blend(canvas, x, y, color)


def draw_rounded_rect(
    canvas: PixelBuffer,
    cx: float,
    cy: float,
    width: float,
    height: float,
    radius: float,
    color: Color,
) -> None:
    size = len(canvas)
    hw = width * size / 2
    hh = height * size / 2
    rad = radius * size
    ccx = cx * size
    ccy = cy * size
    x0 = max(0, int(ccx - hw))
    x1 = min(size - 1, int(ccx + hw) + 1)
    y0 = max(0, int(ccy - hh))
    y1 = min(size - 1, int(ccy + hh) + 1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            dx = max(abs(x - ccx) - hw + rad, 0)
            dy = max(abs(y - ccy) - hh + rad, 0)
            if dx * dx + dy * dy <= rad * rad:
                blend(canvas, x, y, color)


def downsample(canvas: PixelBuffer, factor: int) -> PixelBuffer:
    if factor == 1:
        return canvas

    size = len(canvas) // factor
    result: PixelBuffer = []
    for y in range(size):
        row = bytearray(size * 4)
        for x in range(size):
            total = [0, 0, 0, 0]
            for yy in range(factor):
                source = canvas[y * factor + yy]
                for xx in range(factor):
                    i = (x * factor + xx) * 4
                    total[0] += source[i]
                    total[1] += source[i + 1]
                    total[2] += source[i + 2]
                    total[3] += source[i + 3]
            i = x * 4
            scale = factor * factor
            row[i : i + 4] = bytes(clamp(v / scale) for v in total)
        result.append(row)
    return result


def write_png(path: Path, canvas: PixelBuffer) -> None:
    width = len(canvas[0]) // 4
    height = len(canvas)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(row) for row in canvas)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def render_orbit(size: int) -> PixelBuffer:
    factor = 3 if size <= 180 else 2 if size <= 512 else 1
    canvas = make_canvas(size * factor)

    for radius, alpha in [(0.39, 22), (0.31, 28), (0.14, 46)]:
        draw_circle(canvas, 0.5, 0.48, radius, (74, 222, 128, alpha))

    draw_ring(canvas, 0.5, 0.48, 0.31, 0.024, (232, 228, 222, 142))
    draw_ring(canvas, 0.5, 0.48, 0.235, 0.012, (74, 222, 128, 92))

    for cx, cy, alpha in [
        (0.5, 0.17, 148),
        (0.5, 0.79, 96),
        (0.19, 0.48, 96),
        (0.81, 0.48, 148),
    ]:
        draw_rounded_rect(canvas, cx, cy, 0.105, 0.105, 0.018, (232, 228, 222, alpha))

    for cx, cy in [(0.39, 0.59), (0.5, 0.64), (0.61, 0.59)]:
        draw_rounded_rect(canvas, cx, cy, 0.078, 0.078, 0.014, (74, 222, 128, 74))

    draw_circle(canvas, 0.5, 0.48, 0.111, (74, 222, 128, 60))
    draw_circle(canvas, 0.5, 0.48, 0.072, (74, 222, 128, 255))
    draw_circle(canvas, 0.47, 0.45, 0.024, (232, 228, 222, 120))
    return downsample(canvas, factor)


def render_grid(size: int) -> PixelBuffer:
    factor = 3 if size <= 180 else 2 if size <= 512 else 1
    canvas = make_canvas(size * factor)
    positions = []
    for row in range(5):
        for col in range(5):
            positions.append((0.28 + col * 0.11, 0.28 + row * 0.11))

    center = (0.5, 0.5)
    for cx, cy in positions:
        d = math.sqrt((cx - center[0]) ** 2 + (cy - center[1]) ** 2)
        alpha = clamp(150 - d * 260, 34, 160)
        color = (232, 228, 222, alpha) if d > 0.09 else (74, 222, 128, 240)
        draw_rounded_rect(canvas, cx, cy, 0.079, 0.079, 0.015, color)

    draw_ring(canvas, 0.5, 0.5, 0.335, 0.015, (74, 222, 128, 84))
    draw_circle(canvas, 0.5, 0.5, 0.052, (74, 222, 128, 255))
    return downsample(canvas, factor)


def paste_center(canvas: PixelBuffer, source: PixelBuffer, center_x: int, center_y: int) -> None:
    source_width = len(source[0]) // 4
    source_height = len(source)
    left = center_x - source_width // 2
    top = center_y - source_height // 2
    for y, row in enumerate(source):
        target_y = top + y
        if target_y < 0 or target_y >= len(canvas):
            continue
        for x in range(source_width):
            i = x * 4
            blend(canvas, left + x, target_y, (row[i], row[i + 1], row[i + 2], row[i + 3]))


def render_og() -> PixelBuffer:
    canvas = make_canvas_rect(1200, 630)
    for radius, alpha in [(0.34, 18), (0.24, 26)]:
        draw_circle(canvas, 0.5, 0.5, radius, (74, 222, 128, alpha))
    paste_center(canvas, render_orbit(430), 600, 315)
    return canvas


def png_bytes(canvas: PixelBuffer) -> bytes:
    temp = ROOT / ".tmp-logo.png"
    write_png(temp, canvas)
    data = temp.read_bytes()
    temp.unlink()
    return data


def write_ico(path: Path, sizes: list[int]) -> None:
    images = [png_bytes(render_orbit(size)) for size in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    directory = bytearray()
    payload = bytearray()
    for size, data in zip(sizes, images):
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                size if size < 256 else 0,
                size if size < 256 else 0,
                0,
                0,
                1,
                32,
                len(data),
                offset,
            )
        )
        payload.extend(data)
        offset += len(data)
    path.write_bytes(header + directory + payload)


def write_svg(path: Path) -> None:
    path.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title>Still Point logo mark</title>
  <defs>
    <radialGradient id="bg" cx="42%" cy="38%" r="78%">
      <stop offset="0" stop-color="#1d2f22"/>
      <stop offset="0.55" stop-color="#1a1816"/>
      <stop offset="1" stop-color="#0b0f0f"/>
    </radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#bg)"/>
  <circle cx="32" cy="32" r="21" fill="none" stroke="#4ade80" stroke-opacity=".32" stroke-width="1.5"/>
  <g fill="#e8e4de" fill-opacity=".36">
    <rect x="17" y="17" width="5" height="5" rx="1.2"/><rect x="24.5" y="17" width="5" height="5" rx="1.2"/>
    <rect x="34.5" y="17" width="5" height="5" rx="1.2"/><rect x="42" y="17" width="5" height="5" rx="1.2"/>
    <rect x="17" y="24.5" width="5" height="5" rx="1.2"/><rect x="42" y="24.5" width="5" height="5" rx="1.2"/>
    <rect x="17" y="34.5" width="5" height="5" rx="1.2"/><rect x="42" y="34.5" width="5" height="5" rx="1.2"/>
    <rect x="17" y="42" width="5" height="5" rx="1.2"/><rect x="24.5" y="42" width="5" height="5" rx="1.2"/>
    <rect x="34.5" y="42" width="5" height="5" rx="1.2"/><rect x="42" y="42" width="5" height="5" rx="1.2"/>
  </g>
  <g fill="#e8e4de" fill-opacity=".55">
    <rect x="24.5" y="24.5" width="5" height="5" rx="1.2"/><rect x="34.5" y="24.5" width="5" height="5" rx="1.2"/>
    <rect x="24.5" y="34.5" width="5" height="5" rx="1.2"/><rect x="34.5" y="34.5" width="5" height="5" rx="1.2"/>
  </g>
  <circle cx="32" cy="32" r="7" fill="#4ade80" fill-opacity=".26" filter="url(#glow)"/>
  <rect x="29.5" y="29.5" width="5" height="5" rx="1.2" fill="#4ade80"/>
</svg>
""",
        encoding="utf-8",
    )


def main() -> None:
    write_png(ROOT / "docs/brand/logo-concepts/concept-a-quiet-orbit.png", render_orbit(1024))
    write_png(ROOT / "docs/brand/logo-concepts/concept-b-breathing-boxes.png", render_grid(1024))
    write_png(ROOT / "ios/StillPointApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png", render_orbit(1024))
    write_png(ROOT / "src/app/icon.png", render_orbit(512))
    write_png(ROOT / "src/app/apple-icon.png", render_orbit(180))
    write_png(ROOT / "public/logo-mark.png", render_orbit(512))
    write_png(ROOT / "public/og.png", render_og())
    write_ico(ROOT / "src/app/favicon.ico", [16, 32, 48])
    write_svg(ROOT / "public/logo-mark.svg")


if __name__ == "__main__":
    main()
