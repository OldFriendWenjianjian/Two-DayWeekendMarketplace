from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "branding"
WEB_PUBLIC = ROOT / "web" / "public"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/seguisb.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def rounded(draw: ImageDraw.ImageDraw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_icon(path: Path, size: int = 1024):
    img = Image.new("RGBA", (size, size), "#f7fbff")
    draw = ImageDraw.Draw(img)

    # Background with subtle commerce and ledger colors.
    for y in range(size):
        t = y / size
        r = int(17 + 40 * t)
        g = int(150 + 55 * t)
        b = int(142 + 55 * (1 - t))
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i, alpha in enumerate([36, 30, 24, 20]):
        offset = i * 110
        od.ellipse((size * 0.55 - offset, -120 + offset, size * 1.08 - offset, size * 0.42 + offset), fill=(255, 255, 255, alpha))
    img = Image.alpha_composite(img, overlay)
    draw = ImageDraw.Draw(img)

    # Storefront body.
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    rounded(sd, (182, 318, 842, 808), 86, (0, 45, 48, 72))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    img = Image.alpha_composite(img, shadow)
    draw = ImageDraw.Draw(img)

    rounded(draw, (164, 286, 860, 780), 88, (255, 255, 255, 250))
    rounded(draw, (214, 426, 810, 732), 46, (230, 248, 247, 255), outline=(17, 122, 116, 190), width=7)

    # Awning.
    colors = [(255, 118, 84, 255), (255, 255, 255, 255), (37, 174, 161, 255), (255, 255, 255, 255), (255, 196, 64, 255)]
    stripe_w = 696 / len(colors)
    for i, color in enumerate(colors):
        x0 = 164 + i * stripe_w
        x1 = 164 + (i + 1) * stripe_w
        draw.rounded_rectangle((x0, 250, x1, 418), radius=34, fill=color)
    draw.line((164, 418, 860, 418), fill=(14, 103, 98, 255), width=10)

    # Chain nodes around the sign.
    node_color = (31, 95, 180, 255)
    link_color = (31, 95, 180, 120)
    nodes = [(292, 540), (418, 494), (544, 546), (670, 500), (742, 614)]
    for a, b in zip(nodes, nodes[1:]):
        draw.line((a[0], a[1], b[0], b[1]), fill=link_color, width=16)
    for i, (x, y) in enumerate(nodes):
        fill = (255, 196, 64, 255) if i == 2 else node_color
        draw.ellipse((x - 34, y - 34, x + 34, y + 34), fill=fill, outline=(255, 255, 255, 255), width=8)

    # Brand mark.
    title_font = font(118, True)
    draw.text((512, 612), "双休", font=title_font, anchor="mm", fill=(20, 48, 62, 255))
    draw.text((512, 714), "超市", font=font(74, True), anchor="mm", fill=(21, 116, 111, 255))

    img.save(path)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int):
    lines: list[str] = []
    current = ""
    for char in text:
        test = current + char
        if draw.textlength(test, font=fnt) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def draw_phone(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int):
    rounded(draw, (x, y, x + w, y + h), 54, (25, 31, 38, 255))
    rounded(draw, (x + 18, y + 22, x + w - 18, y + h - 22), 42, (248, 252, 252, 255))
    draw.rounded_rectangle((x + w // 2 - 68, y + 12, x + w // 2 + 68, y + 35), radius=14, fill=(25, 31, 38, 255))

    sx, sy = x + 40, y + 72
    rounded(draw, (sx, sy, x + w - 40, sy + 130), 30, (16, 155, 146, 255))
    draw.text((sx + 32, sy + 34), "双休超市", font=font(33, True), fill="white")
    draw.text((sx + 32, sy + 82), "只收双休不加班公司", font=font(22), fill=(225, 255, 250, 255))

    for i, (name, price, color) in enumerate([
        ("手作银饰直播中", "¥128", (255, 118, 84, 255)),
        ("双休咖啡豆", "¥69", (255, 196, 64, 255)),
        ("露营折叠灯", "¥89", (31, 95, 180, 255)),
    ]):
        yy = sy + 170 + i * 125
        rounded(draw, (sx, yy, x + w - 40, yy + 98), 24, (255, 255, 255, 255), outline=(217, 230, 230, 255), width=2)
        rounded(draw, (sx + 18, yy + 18, sx + 88, yy + 88), 18, color)
        draw.text((sx + 108, yy + 22), name, font=font(23, True), fill=(29, 42, 54, 255))
        draw.text((sx + 108, yy + 58), price, font=font(22, True), fill=(218, 71, 54, 255))

    rounded(draw, (sx, y + h - 96, x + w - 40, y + h - 44), 26, (255, 196, 64, 255))
    draw.text((x + w / 2, y + h - 70), "查看直播与商品", font=font(22, True), anchor="mm", fill=(37, 39, 44, 255))


def draw_poster(path: Path, width: int = 1080, height: int = 1920):
    img = Image.new("RGBA", (width, height), "#f4f8f6")
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / height
        r = int(244 - 14 * t)
        g = int(248 - 18 * t)
        b = int(246 - 8 * t)
        draw.line((0, y, width, y), fill=(r, g, b, 255))

    # Dynamic but not single-hue background.
    for cx, cy, radius, color in [
        (150, 220, 320, (255, 196, 64, 42)),
        (990, 560, 370, (255, 118, 84, 36)),
        (120, 1550, 420, (37, 174, 161, 38)),
    ]:
        layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)
        layer = layer.filter(ImageFilter.GaussianBlur(42))
        img.alpha_composite(layer)
    draw = ImageDraw.Draw(img)

    draw.text((78, 110), "双休超市", font=font(86, True), fill=(18, 48, 59, 255))
    draw.text((82, 214), "只上架双休不加班公司的产品", font=font(43, True), fill=(21, 116, 111, 255))

    body = "我的理念：支持好产品，也支持做出好产品的人按时下班。店家入驻需要承诺双休、不强制加班，评价、投诉和治理下架记录写入私有签名账本。"
    y = 300
    for line in wrap_text(draw, body, font(32), 880):
        draw.text((82, y), line, font=font(32), fill=(61, 75, 86, 255))
        y += 48

    draw_phone(draw, 122, 620, 520, 930)

    # Ledger cards.
    card_x = 680
    for i, (title, desc, color) in enumerate([
        ("双休承诺", "只展示不加班公司的产品", (37, 174, 161, 255)),
        ("品牌 ID", "不可删除 / 不可复用", (31, 95, 180, 255)),
        ("投票下架", "违背理念可社区治理", (255, 118, 84, 255)),
        ("直播发现", "服务器索引，视频直连", (255, 196, 64, 255)),
    ]):
        yy = 690 + i * 178
        rounded(draw, (card_x, yy, 1010, yy + 132), 28, (255, 255, 255, 238), outline=(219, 232, 229, 255), width=2)
        draw.ellipse((card_x + 26, yy + 34, card_x + 86, yy + 94), fill=color)
        draw.text((card_x + 108, yy + 31), title, font=font(31, True), fill=(24, 42, 52, 255))
        draw.text((card_x + 108, yy + 78), desc, font=font(21), fill=(87, 101, 111, 255))

    # CTA band.
    rounded(draw, (76, 1660, 1004, 1808), 38, (18, 48, 59, 255))
    draw.text((122, 1700), "Android APK 下载", font=font(39, True), fill=(255, 255, 255, 255))
    draw.text((122, 1762), "/shc-20260520-a1faaf/weekend-marketplace/download/", font=font(24), fill=(220, 248, 244, 255))
    draw.text((936, 1734), "APK", font=font(38, True), anchor="mm", fill=(255, 196, 64, 255))

    img.convert("RGB").save(path, quality=95)


def draw_feature(path: Path, width: int = 1024, height: int = 500):
    img = Image.new("RGBA", (width, height), "#f8fbfb")
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / height
        draw.line((0, y, width, y), fill=(int(248 - 20 * t), int(251 - 12 * t), int(251 - 25 * t), 255))

    draw.text((56, 70), "双休超市", font=font(64, True), fill=(18, 48, 59, 255))
    draw.text((58, 152), "只买双休不加班公司的产品", font=font(32, True), fill=(21, 116, 111, 255))
    for i, text in enumerate(["双休不加班承诺", "全球唯一店家 ID", "评价投诉上链", "投票治理下架"]):
        x = 60 + (i % 2) * 280
        y = 245 + (i // 2) * 80
        rounded(draw, (x, y, x + 236, y + 48), 24, (255, 255, 255, 245), outline=(216, 230, 228, 255), width=2)
        draw.text((x + 118, y + 24), text, font=font(21, True), anchor="mm", fill=(48, 62, 72, 255))

    # Abstract app icon at right.
    icon_path = OUT / "icon-1024.png"
    if icon_path.exists():
        icon = Image.open(icon_path).resize((250, 250))
        img.alpha_composite(icon, (710, 116))
    img.convert("RGB").save(path, quality=94)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    icon_path = OUT / "icon-1024.png"
    draw_icon(icon_path)
    draw_poster(OUT / "poster-1080x1920.png")
    draw_feature(OUT / "feature-1024x500.png")
    export_web_icons(icon_path)
    export_android_icons(icon_path)
    print(f"Generated branding assets in {OUT}")


def export_web_icons(icon_path: Path):
    if not WEB_PUBLIC.exists():
        return
    icon = Image.open(icon_path).convert("RGBA")
    for size in (192, 512):
        icon.resize((size, size), Image.Resampling.LANCZOS).save(WEB_PUBLIC / f"icon-{size}.png")


def export_android_icons(icon_path: Path):
    if not ANDROID_RES.exists():
        return
    icon = Image.open(icon_path).convert("RGBA")
    launcher_sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    foreground_sizes = {
        "mipmap-mdpi": 108,
        "mipmap-hdpi": 162,
        "mipmap-xhdpi": 216,
        "mipmap-xxhdpi": 324,
        "mipmap-xxxhdpi": 432,
    }
    for directory, size in launcher_sizes.items():
        target_dir = ANDROID_RES / directory
        target_dir.mkdir(parents=True, exist_ok=True)
        icon.resize((size, size), Image.Resampling.LANCZOS).save(target_dir / "ic_launcher.png")
        icon.resize((size, size), Image.Resampling.LANCZOS).save(target_dir / "ic_launcher_round.png")
    for directory, size in foreground_sizes.items():
        target_dir = ANDROID_RES / directory
        target_dir.mkdir(parents=True, exist_ok=True)
        icon.resize((size, size), Image.Resampling.LANCZOS).save(target_dir / "ic_launcher_foreground.png")


if __name__ == "__main__":
    main()
