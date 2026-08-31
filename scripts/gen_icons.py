#!/usr/bin/env python3
"""Generate the PWA icons from the Family Vault brand mark (no external deps).

Draws the same symbol as src/components/brand/VaultMark.tsx — a teal shield
enclosing a vault dial — on the app's ink background, so the installed icon,
the favicon and the in-app header all read as one brand.

Geometry is expressed in the mark's 32x32 design space and scaled to the target
size. Edges are 4x4 supersampled, since this rasterizer is hand-rolled.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")

BG = (11, 18, 32)          # ink-900 — matches the app background
DIAL = (6, 35, 31)         # deep teal-ink, same as the SVG mark
GRAD_TOP = (94, 234, 212)  # vault-300
GRAD_MID = (20, 184, 166)  # vault-500
GRAD_BOT = (15, 118, 110)  # vault-700

SS = 4  # supersampling factor per axis

# ── Mark geometry, in the 32x32 design space ────────────────────────────────
APEX_Y, SHOULDER_Y = 2.2, 6.6
WAIST_Y, TIP_Y = 15.3, 29.8
HALF_W = 11.0
CX = 16.0
DIAL_CY, DIAL_R, DIAL_SW = 15.4, 5.3, 2.1
HUB_R = 1.9
SPOKE_HW = 0.95


def _png(width, height, pixels):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0
        for x in range(width):
            raw += bytes(pixels[y * width + x])
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def in_shield(x, y):
    """Point-in-shield test in design space."""
    if y < APEX_Y or y > TIP_Y:
        return False
    hx = abs(x - CX)
    if y < SHOULDER_Y:
        # Sloped shoulders rising to the apex.
        return hx <= HALF_W * (y - APEX_Y) / (SHOULDER_Y - APEX_Y)
    if y <= WAIST_Y:
        return hx <= HALF_W
    # Lower body tapering to the tip.
    t = (y - WAIST_Y) / (TIP_Y - WAIST_Y)
    return hx <= HALF_W * max(0.0, 1.0 - t ** 2.2) ** 0.62


def in_dial(x, y):
    """Ring, four spokes and hub — the parts drawn in ink over the shield."""
    dx, dy = x - CX, y - DIAL_CY
    d = (dx * dx + dy * dy) ** 0.5
    if abs(d - DIAL_R) <= DIAL_SW / 2:      # ring
        return True
    if d <= HUB_R:                           # hub
        return True
    # Spokes: two vertical (above/below), two horizontal (left/right).
    if abs(dx) <= SPOKE_HW and 7.6 <= y <= 10.1:
        return True
    if abs(dx) <= SPOKE_HW and 20.7 <= y <= 23.2:
        return True
    if abs(dy) <= SPOKE_HW and 8.2 <= x <= 10.7:
        return True
    if abs(dy) <= SPOKE_HW and 21.3 <= x <= 23.8:
        return True
    return False


def shield_color(y):
    """Vertical teal gradient matching the SVG's linear gradient stops."""
    t = min(1.0, max(0.0, (y - APEX_Y) / (TIP_Y - APEX_Y)))
    if t < 0.55:
        u = t / 0.55
        a, b = GRAD_TOP, GRAD_MID
    else:
        u = (t - 0.55) / 0.45
        a, b = GRAD_MID, GRAD_BOT
    return tuple(round(a[i] + (b[i] - a[i]) * u) for i in range(3))


def draw(size, padding_ratio):
    """Render the mark at `size` px, inset by `padding_ratio` on each side."""
    px = [BG] * (size * size)
    inner = size * (1 - 2 * padding_ratio)
    origin = size * padding_ratio
    step = 1.0 / SS

    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    # Pixel-centre sample → design space.
                    px_x = x + (sx + 0.5) * step
                    px_y = y + (sy + 0.5) * step
                    dx = (px_x - origin) / inner * 32.0
                    dy = (px_y - origin) / inner * 32.0
                    if in_shield(dx, dy):
                        c = DIAL if in_dial(dx, dy) else shield_color(dy)
                    else:
                        c = BG
                    acc[0] += c[0]
                    acc[1] += c[1]
                    acc[2] += c[2]
            n = SS * SS
            px[y * size + x] = (acc[0] // n, acc[1] // n, acc[2] // n)
    return _png(size, size, px)


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "icon-192.png"), "wb") as f:
        f.write(draw(192, 0.10))
    with open(os.path.join(OUT, "icon-512.png"), "wb") as f:
        f.write(draw(512, 0.10))
    # maskable: extra safe-zone padding so the mark isn't clipped by the launcher
    with open(os.path.join(OUT, "icon-512-maskable.png"), "wb") as f:
        f.write(draw(512, 0.20))
    print("icons written to", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
