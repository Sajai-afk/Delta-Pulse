import zlib, struct, math

def chunk(t, d):
    c = struct.pack(">I", len(d)) + t + d
    return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)

def seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def make(size, path):
    s = size; c = s / 2
    A = (c, c - 0.27 * s); B = (c - 0.27 * s, c + 0.2 * s); C = (c + 0.27 * s, c + 0.2 * s)
    th = 0.022 * s
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            d = min(seg(x, y, *A, *B), seg(x, y, *B, *C), seg(x, y, *C, *A))
            g = max(0, min(1, (th - d) / 1.2 + 0.5))
            wave = c + 0.07 * s + 0.018 * s * math.sin((x - c) / s * 18)
            b = max(0, min(1, (0.011 * s - abs(y - wave)) / 1.2 + 0.5)) if abs(x - c) < 0.17 * s else 0
            raw.extend((min(255, int(61 * g + 90 * b)), min(255, int(220 * g + 169 * b)), min(255, int(151 * g + 230 * b))))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b""))

make(192, "public/icon-192.png")
make(512, "public/icon-512.png")
print("icons done")