"""Render inspect-character-rig.mjs output for visual inspection using Pillow."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def norm(a):
    length = math.sqrt(dot(a, a))
    return [x / max(length, 1e-10) for x in a]


reload = '--reload' in sys.argv
first_person = '--first-person' in sys.argv
poses = json.loads(Path('.tmp-rig/poses-fp.json' if first_person else '.tmp-rig/poses-reload.json' if reload else '.tmp-rig/poses.json').read_text())
width, height = 450, 580
hands = '--hands' in sys.argv
eyes = [[0, 0, 0]] if first_person else [[3, 2.6, -5], [-4, 2.3, -3]]
sheet = Image.new('RGB', (len(poses) * width, len(eyes) * height), '#202832')
for row, eye in enumerate(eyes):
    for col, pose in enumerate(poses):
        target = pose['focus'] if hands else [0, 1.3, 0]
        camera = [target[0] + (1 if row == 0 else -1), target[1] + .45, target[2] - .9] if hands else eye
        if first_person:
            target, camera = [0, 0, -1], eye
        forward = norm(sub(target, camera))
        right = norm(cross(forward, [0, 1, 0]))
        up = cross(right, forward)
        panel = Image.new('RGB', (width, height), '#202832')
        draw = ImageDraw.Draw(panel)
        triangles = []
        for mesh in pose['meshes']:
            vertices = mesh['positions']
            projected = []
            for v in vertices:
                d = sub(v, camera)
                z = dot(d, forward)
                focal = 378 if first_person else 800
                projected.append([width/2 + focal*dot(d, right)/max(.001, z), height/2 - focal*dot(d, up)/max(.001, z), z])
            ids = mesh['indices']
            for j in range(0, len(ids), 3):
                idx = ids[j:j+3]
                if first_person and min(projected[k][2] for k in idx) <= .02:
                    continue
                normal = norm(cross(sub(vertices[idx[1]], vertices[idx[0]]), sub(vertices[idx[2]], vertices[idx[0]])))
                light = .5 + .5*abs(dot(normal, norm([1, 2, -1])))
                rgb = tuple(int(max(0, min(255, sum(mesh['colors'][k][c] for k in idx)/3 * light * 255))) for c in range(3))
                points = [(projected[k][0], projected[k][1]) for k in idx]
                triangles.append((sum(projected[k][2] for k in idx)/3, points, rgb))
        for _, points, rgb in sorted(triangles, reverse=True):
            draw.polygon(points, fill=rgb)
        draw.text((15, 15), pose['label'], fill='white')
        sheet.paste(panel, (col*width, row*height))
output = '.tmp-rig/character-fp.png' if first_person else '.tmp-rig/character-reload.png' if reload else '.tmp-rig/character-hands.png' if hands else '.tmp-rig/character-motion.png'
sheet.save(output)
print(output)
