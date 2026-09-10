#!/usr/bin/env python3
"""Generate placeholder PWA icons (no external deps).

Draws a teal rounded-square "vault" mark with a lighter dial. These are intentionally
simple placeholders for Phase 0 — replace with designed assets later.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
BG = (15, 118, 110)        # vault-700
FG = (240, 253, 250)       # vault-50
INK = (11, 18, 32)         # ink-900


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


def draw(size, padding_ratio):
    px = [BG] * (size * size)
    pad = int(size * padding_ratio)
    inner = size - 2 * pad
    radius = inner * 0.22
    cx, cy = size / 2, size / 2

    def rounded(x, y, x0, y0, x1, y1, r):
        # inside rounded rect [x0,x1]x[y0,y1] with corner radius r
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        rx = min(max(x, x0 + r), x1 - r)
        ry = min(max(y, y0 + r), y1 - r)
        return (x - rx) ** 2 + (y - ry) ** 2 <= r * r or (x0 + r <= x <= x1 - r) or (y0 + r <= y <= y1 - r)

    x0, y0, x1, y1 = pad, pad, size - pad, size - pad
    door_pad = inner * 0.16
    dx0, dy0, dx1, dy1 = x0 + door_pad, y0 + door_pad, x1 - door_pad, y1 - door_pad
    dial_r = inner * 0.16
    spoke_r = inner * 0.05

    for y in range(size):
        for x in range(size):
            i = y * size + x
            # vault face (light rounded square)
            if rounded(x, y, dx0, dy0, dx1, dy1, radius * 0.7):
                px[i] = FG
            # dial
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if d2 <= dial_r ** 2:
                px[i] = INK
            if (dial_r - spoke_r) ** 2 <= d2 <= dial_r ** 2:
                px[i] = INK
            if d2 <= spoke_r ** 2:
                px[i] = FG
    return _png(size, size, px)


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "icon-192.png"), "wb") as f:
        f.write(draw(192, 0.10))
    with open(os.path.join(OUT, "icon-512.png"), "wb") as f:
        f.write(draw(512, 0.10))
    # maskable: extra safe-zone padding so the mark isn't clipped
    with open(os.path.join(OUT, "icon-512-maskable.png"), "wb") as f:
        f.write(draw(512, 0.20))
    print("icons written to", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
