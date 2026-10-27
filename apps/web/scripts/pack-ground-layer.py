"""Packs one PBR ground material into the terrain shader's layer files (see public/textures/ground/README.md).

  python apps/web/scripts/pack-ground-layer.py <layer> <base> <normal> <orm|-> [--absolute]

<base> albedo, <normal> OpenGL normal map, <orm> occlusion/roughness/metal (R/G/B, glTF layout) or '-'.
Writes <size>/<layer>-a.webp (albedo / its mean colour x 0.5, or the plain albedo with --absolute
for layers drawn in their own colour), <size>/<layer>-n.webp (normal X/Y, roughness) for 512 and
1024 px, and h/<layer>-h.png (256 px height, stretched to full range: occlusion and albedo
luminance, high-passed, since these materials ship no height map). Prints the mean colour.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter, ImageOps

root = Path(__file__).resolve().parents[1] / 'public' / 'textures' / 'ground'
layer, base_p, normal_p, orm_p = sys.argv[1:5]
absolute = '--absolute' in sys.argv

base = Image.open(base_p).convert('RGB')
normal = Image.open(normal_p).convert('RGB').resize(base.size, Image.LANCZOS)
orm = Image.open(orm_p).convert('RGB').resize(base.size, Image.LANCZOS) if orm_p != '-' else None

mean = [sum(i * n for i, n in enumerate(base.getchannel(c).histogram())) / (base.width * base.height) for c in range(3)]
if absolute:
    albedo = base
else:
    albedo = Image.merge('RGB', [base.getchannel(c).point(lambda v, m=mean[c]: max(0, min(255, round(v / m * 127.5)))) for c in range(3)])
rough = orm.getchannel('G') if orm else Image.new('L', base.size, 235)
packed = Image.merge('RGB', (normal.getchannel('R'), normal.getchannel('G'), rough))

for size in (512, 1024):
    (root / str(size)).mkdir(parents=True, exist_ok=True)
    albedo.resize((size, size), Image.LANCZOS).save(root / str(size) / f'{layer}-a.webp', quality=88)
    packed.resize((size, size), Image.LANCZOS).save(root / str(size) / f'{layer}-n.webp', quality=92)

# Height: crevices low, crowns high. Occlusion carries the cracks; luminance the grain. High-pass
# so large light/dark patches do not read as hills, then stretch to the full range.
lum = ImageOps.grayscale(base)
height = ImageChops.multiply(orm.getchannel('R'), lum) if orm else lum
blur = height.filter(ImageFilter.GaussianBlur(base.width / 16))
height = ImageChops.add(ImageChops.subtract(height, blur, 1, 128), Image.new('L', base.size, 0))
height = ImageOps.autocontrast(height.resize((256, 256), Image.LANCZOS), cutoff=1)
(root / 'h').mkdir(exist_ok=True)
height.save(root / 'h' / f'{layer}-h.png')
print(layer, [round(m) for m in mean])
