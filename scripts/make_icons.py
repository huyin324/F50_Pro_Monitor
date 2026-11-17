# -*- coding: utf-8 -*-
"""生成 Tauri 所需的应用图标（PNG / ICO）。依赖：pip install Pillow"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)
S = 512


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_gradient(size):
    img = Image.new("RGB", (size, size), "#2F80ED")
    d = ImageDraw.Draw(img)
    c0, c1 = (47, 128, 237), (25, 179, 122)
    for y in range(size):
        for_x = y / max(1, size - 1)
        d.line([(0, y), (size, y)], fill=lerp(c0, c1, (y / size + 0) * 0.85 + for_x * 0.0))
    return img


def build(size=S):
    scale = size / 256.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [8 * scale, 8 * scale, 248 * scale, 248 * scale], radius=56 * scale, fill=255
    )
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    c0, c1 = (47, 128, 237), (25, 179, 122)
    for y in range(size):
        t = y / max(1, size - 1)
        c = lerp(c0, c1, t)
        for x in range(size):
            px[x, y] = (*c, 255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    w = max(2, int(18 * scale))
    # 三层信号弧
    for box, alpha in [((62, 112, 194, 244), 0.55), ((86, 136, 170, 218), 0.78), ((110, 160, 146, 194), 1.0)]:
        b = tuple(int(v * scale) for v in box)
        color = (255, 255, 255, int(255 * alpha))
        d.arc(b, start=200, end=340, fill=color, width=w)
    r = 12 * scale
    cx, cy = 128 * scale, 190 * scale
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))

    # 5G 文本
    font = None
    for fp in [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\msyhbd.ttc"]:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, int(40 * scale))
                break
            except OSError:
                pass
    if font:
        d.text((128 * scale, 52 * scale), "5G", font=font, fill=(255, 255, 255, 255), anchor="mt")
    return img


big = build(S)
big.save(os.path.join(OUT, "icon.png"))
for s, name in [(128, "128x128.png"), (256, "128x128@2x.png"), (32, "32x32.png")]:
    big.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, name))

# ICO：多尺寸，兼容任务栏 / 资源管理器
big.resize((256, 256), Image.LANCZOS).save(
    os.path.join(OUT, "icon.ico"), format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
print("icons ->", OUT)
