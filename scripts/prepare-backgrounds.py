"""Normalize generated scenery; remove keyed backing offline, never during gameplay.
Requires Pillow and NumPy. Sources/prompts live in art/backgrounds; runtime WebP in public.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
for directory in sorted((ROOT / 'art/backgrounds').iterdir()):
    if not directory.is_dir():
        continue
    destination = ROOT / 'public/backgrounds' / directory.name
    destination.mkdir(parents=True, exist_ok=True)
    for path in sorted(directory.glob('*.png')):
        image = Image.open(path).convert('RGBA')
        keyed = path.stem.endswith('-key')
        if keyed:
            data = np.array(image).astype(np.float32)
            # Key only pixels close to the backing color. A general magenta
            # suppression would also damage the graveyard's purple material.
            distance = np.maximum.reduce([255 - data[:, :, 0], data[:, :, 1], 255 - data[:, :, 2]])
            backing = distance < 60
            if directory.name in {'ice', 'rooftop', 'cavern', 'ghostship', 'peak'}:
                # These cool-colored overlays contain no purple surfaces; also
                # remove darkened key color trapped in gaps between objects.
                spill = np.minimum(data[:, :, 0], data[:, :, 2]) - data[:, :, 1]
                backing |= spill > 25
            alpha = np.where(backing, 0, 255).astype('uint8')
            # Remove two source edge pixels, then downsample for clean antialiasing.
            mask = Image.fromarray(alpha).filter(ImageFilter.MinFilter(5))
            data[:, :, 3] = np.minimum(data[:, :, 3], np.array(mask))
            # Reconstruct the narrow edge band from adjacent interior colors.
            # This removes pink light baked into antialiasing without suppressing
            # purple surfaces elsewhere in the image or adding a gray fringe.
            occupied = data[:, :, 3] > 0
            known = np.array(mask.filter(ImageFilter.MinFilter(13))) > 0
            rgb = data[:, :, :3].copy()
            for _ in range(12):
                totals = np.zeros_like(rgb)
                counts = np.zeros(known.shape, dtype=np.float32)
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    neighbor = np.roll(known, (dy, dx), (0, 1))
                    if dy == -1: neighbor[-1, :] = False
                    if dy == 1: neighbor[0, :] = False
                    if dx == -1: neighbor[:, -1] = False
                    if dx == 1: neighbor[:, 0] = False
                    totals += np.roll(rgb, (dy, dx), (0, 1)) * neighbor[:, :, None]
                    counts += neighbor
                fill = occupied & ~known & (counts > 0)
                rgb[fill] = totals[fill] / counts[fill, None]
                known |= fill
            data[:, :, :3] = rgb
            data[:, :, 3][occupied & ~known] = 0
            data[data[:, :, 3] == 0, :3] = 0
            image = Image.fromarray(data.astype('uint8'))
        image = image.resize((1536, 864), Image.Resampling.LANCZOS)
        name = path.stem.removesuffix('-key')
        if name == 'far':
            image = image.convert('RGB')
        output = destination / f'{name}.webp'
        image.save(output, 'WEBP', quality=88, method=6)
        print(f'{output.relative_to(ROOT)}: {output.stat().st_size // 1024} KiB, {image.mode}')
