from pathlib import Path
from PIL import Image
import json

ROOT = Path(".")
OUT = Path(".")

JOBS = [
    ("assets/novelight-feature-discovery.png", "assets/novelight-feature-discovery.webp", 256, 90),
    ("assets/novelight-feature-light-seed.png", "assets/novelight-feature-light-seed.webp", 256, 90),
    ("assets/novelight-feature-analytics.png", "assets/novelight-feature-analytics.webp", 256, 90),

    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_20 (1).png", "assets/author-room/action-post.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_20 (2).png", "assets/author-room/action-works.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_21 (4).png", "assets/author-room/action-seed.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_22 (5).png", "assets/author-room/action-plan.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_22 (6).png", "assets/author-room/metric-works.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_22 (7).png", "assets/author-room/metric-episodes.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_22 (8).png", "assets/author-room/metric-readers.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_22 (9).png", "assets/author-room/metric-favorites.webp", 192, 90),
    ("assets/author-room/ChatGPT Image 2026年9月7日 01_37_23 (10).png", "assets/author-room/metric-comments.webp", 192, 90),

    ("assets/NOVELIGHT_PC_HERO_FINAL_2560x1280.png", "assets/NOVELIGHT_PC_HERO_FINAL_2560x1280.webp", 2560, 88),
    ("assets/NOVELIGHT_MOBILE_HERO_FINAL_900x1600.png", "assets/NOVELIGHT_MOBILE_HERO_FINAL_900x1600.webp", 1600, 88),
    ("assets/NOVELIGHT_NOCTURNE_FINAL_800x1000.png", "assets/NOVELIGHT_NOCTURNE_FINAL_800x1000.webp", 1000, 90),
    ("assets/ChatGPT Image 2026年9月7日 09_56_44.png", "assets/novelight-beta-brand.webp", 1200, 90),
    ("assets/founding-authors-badge-2026.png", "assets/founding-authors-badge-2026.webp", 640, 90),
    ("assets/NOVELIGHT_LP_BELOW_HERO_PC_2560x1800 (1).png", "assets/NOVELIGHT_LP_BELOW_HERO_PC_2560x1800.webp", 2560, 88),
]

OUT.mkdir(parents=True, exist_ok=True)
report = []

for source_name, output_name, max_edge, quality in JOBS:
    source = ROOT / source_name
    if not source.is_file():
        raise FileNotFoundError(source)

    with Image.open(source) as image:
        original_size = image.size
        image.load()
        if max(image.size) > max_edge:
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")

        target = OUT / output_name
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, "WEBP", quality=quality, method=6)

        report.append({
            "source": source_name,
            "output": output_name,
            "source_bytes": source.stat().st_size,
            "output_bytes": target.stat().st_size,
            "source_dimensions": original_size,
            "output_dimensions": image.size,
            "quality": quality,
        })

print(json.dumps(report, ensure_ascii=False, indent=2))
