"""Replaces the survivor's trousers (slot `legs` in models/characters/zion-survivor.glb) with another
garment model (a static, textured GLB such as a Sketchfab export).

The new trousers are fitted slice by slice onto the old ones: per height, and per leg below the
crotch, their width and depth are mapped onto the old trousers' extent at the same point, so the
legs line up whatever pose or proportions the source has. Vertices that would sink into the body
are pushed out over the skin, the skin weights come from the nearest old-trousers vertex (same
leg), and the base colour texture (times its ambient occlusion) is baked into vertex colours,
which the game tints with the chosen trouser colour.

Afterwards rebuild the hidden skin under the clothes and copy the model to public/:
  tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/prepare-character-skin.mjs
Usage (repo root): python apps/web/scripts/replace-character-garment.py <garment.glb> [label] [--feet]
(--feet: one boot model, fitted onto both boots instead of the trousers)
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

SURVIVOR = 'models/characters/zion-survivor.glb'


def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    return j, bytearray(b[20 + n + 8:])


def read(j, binary, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8, 5120: np.int8}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = np.dtype(dt).itemsize
    stride = bv.get('byteStride', n * size)
    raw = np.frombuffer(bytes(binary), np.uint8)
    rows = np.stack([raw[off + k * stride: off + k * stride + n * size] for k in range(a['count'])]) if stride != n * size else raw[off: off + a['count'] * n * size]
    return np.frombuffer(np.ascontiguousarray(rows).tobytes(), dt).reshape(a['count'], n).astype(np.float64 if dt == np.float32 else dt)


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if 'scale' in node:
        m = np.diag([*node['scale'], 1]) @ m
    if 'rotation' in node:
        x, y, z, w = node['rotation']
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        rm = np.eye(4); rm[:3, :3] = r; m = rm @ m
    if 'translation' in node:
        t = np.eye(4); t[:3, 3] = node['translation']; m = t @ m
    return m


def garment(path):
    """All mesh primitives of a static GLB in scene space: positions, uvs, indices, texture colour."""
    j, binary = load(path)
    parents = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}

    def world(i):
        m = node_matrix(j['nodes'][i])
        return world(parents[i]) @ m if i in parents else m

    images = {}

    def image(tex):
        if tex is None:
            return None
        src = j['textures'][tex['index']]['source']
        if src not in images:
            bv = j['bufferViews'][j['images'][src]['bufferView']]
            data = bytes(binary[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
            images[src] = np.asarray(Image.open(io.BytesIO(data)).convert('RGB'), dtype=np.float64) / 255
        return images[src]

    def sample(img, uv):
        h, w, _ = img.shape
        x = (uv[:, 0] % 1) * (w - 1)
        y = (uv[:, 1] % 1) * (h - 1)
        x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
        x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)

    pos, col, idx = [], [], []
    for i, node in enumerate(j['nodes']):
        if 'mesh' not in node:
            continue
        m = world(i)
        for prim in j['meshes'][node['mesh']]['primitives']:
            p = read(j, binary, prim['attributes']['POSITION'])
            p = (m @ np.c_[p, np.ones(len(p))].T).T[:, :3]
            uv = read(j, binary, prim['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in prim['attributes'] else np.zeros((len(p), 2))
            mat = j['materials'][prim.get('material', 0)] if j.get('materials') else {}
            pbr = mat.get('pbrMetallicRoughness', {})
            c = np.ones((len(p), 3)) * np.array(pbr.get('baseColorFactor', [1, 1, 1, 1])[:3])
            base = image(pbr.get('baseColorTexture') or mat.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness', {}).get('diffuseTexture'))
            if base is not None:
                c = c * sample(base, uv) ** 1.0
            ao = image(mat.get('occlusionTexture'))
            if ao is not None:
                c = c * (.35 + .65 * sample(ao, uv)[:, :1])
            ind = read(j, binary, prim['indices']).reshape(-1) if 'indices' in prim else np.arange(len(p))
            idx.append(ind + sum(len(q) for q in pos))
            pos.append(p)
            col.append(c)
    return np.concatenate(pos), np.concatenate(col), np.concatenate(idx).astype(np.int64)


def profile(points, ys, band):
    """Per height: (min x, max x, min z, max z) of the points within `band`, for each side (x < 0, x >= 0)."""
    out = np.zeros((2, len(ys), 4))
    for s, sel in enumerate([points[:, 0] < 0, points[:, 0] >= 0]):
        q = points[sel]
        for k, y in enumerate(ys):
            near = q[np.abs(q[:, 1] - y) < band]
            if not len(near):
                near = q[np.argsort(np.abs(q[:, 1] - y))[:20]]
            out[s, k] = [near[:, 0].min(), near[:, 0].max(), near[:, 2].min(), near[:, 2].max()]
    # Smooth along the height (noise from pockets, cuffs, seams).
    kernel = np.ones(5) / 5
    for s in range(2):
        for c in range(4):
            padded = np.pad(out[s, :, c], 2, mode='edge')
            out[s, :, c] = np.convolve(padded, kernel, mode='valid')
    return out


def crotch(points):
    """Height where the two legs join (the gap between them closes)."""
    ys = np.linspace(points[:, 1].min(), points[:, 1].max(), 200)
    for y in ys:
        near = points[np.abs(points[:, 1] - y) < .01]
        if len(near) and np.abs(near[:, 0]).min() < .005:
            return y
    return ys[int(len(ys) * .7)]


def boots(new, index, old):
    """One boot model onto both old boots: toe forward (+Z), its length and width over each old
    boot, height in proportion, sole on the old sole; mirrored for the other foot."""
    top = new[new[:, 1] > new[:, 1].min() + (new[:, 1].max() - new[:, 1].min()) * .7]
    if top[:, 2].mean() > (new[:, 2].min() + new[:, 2].max()) / 2:
        new = new * np.array([-1, 1, -1])  # the shaft sits over the heel: turn the toe to +Z
    lo, hi = new.min(0), new.max(0)
    parts, faces, sides = [], [], []
    for s, sel in enumerate([old[:, 0] < 0, old[:, 0] >= 0]):
        o_lo, o_hi = old[sel].min(0), old[sel].max(0)
        k = (o_hi[2] - o_lo[2]) / (hi[2] - lo[2])
        src = new * np.array([-1, 1, 1]) if s == 0 else new  # the left boot mirrored
        a, b = src[:, 0].min(), src[:, 0].max()
        q = np.empty_like(src)
        q[:, 0] = o_lo[0] + (src[:, 0] - a) / (b - a) * (o_hi[0] - o_lo[0])
        q[:, 1] = o_lo[1] + (src[:, 1] - lo[1]) * k
        q[:, 2] = o_lo[2] + (src[:, 2] - lo[2]) * k
        tri = index.reshape(-1, 3)
        faces.append((tri[:, ::-1] if s == 0 else tri) + len(new) * s)
        parts.append(q); sides.append(np.full(len(q), s))
    return np.concatenate(parts), np.concatenate(faces).reshape(-1), np.concatenate(sides)


def main():
    feet = '--feet' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--feet']
    src, label = args[0], args[1] if len(args) > 1 else ('Military Boots' if feet else 'Grey Joggers')
    slot = 'feet' if feet else 'legs'
    j, binary = load(SURVIVOR)
    legs_mesh = next(i for i, m in enumerate(j['meshes']) if m.get('extras', {}).get('slot') == slot)
    body_mesh = next(i for i, m in enumerate(j['meshes']) if m.get('extras', {}).get('slot') == 'body')
    old_prim = j['meshes'][legs_mesh]['primitives'][0]
    old = read(j, binary, old_prim['attributes']['POSITION'])
    old_joints = read(j, binary, old_prim['attributes']['JOINTS_0'])
    old_weights = read(j, binary, old_prim['attributes']['WEIGHTS_0'])
    body_prim = j['meshes'][body_mesh]['primitives'][0]
    skin = read(j, binary, body_prim['attributes']['POSITION'])
    skin_n = read(j, binary, body_prim['attributes']['NORMAL']).astype(np.float64) / 127

    new, colour, index = garment(src)
    if feet:
        fitted, index, side = boots(new, index, old)
        colour = np.concatenate([colour, colour])
    else:
        fitted, side = trousers(new, old)
    finish(j, binary, legs_mesh, old_prim, old, old_joints, old_weights, skin, skin_n, fitted, colour, index, side, label, 'military_boots' if feet else 'joggers')


def trousers(new, old):
    # Height: ankle → crotch → waist of the new trousers onto the old ones (piecewise linear).
    knots_new = [new[:, 1].min(), crotch(new), new[:, 1].max()]
    knots_old = [old[:, 1].min(), crotch(old), old[:, 1].max()]
    y = np.interp(new[:, 1], knots_new, knots_old)
    # Width and depth, slice by slice and leg by leg.
    ys = np.linspace(knots_old[0], knots_old[2], 60)
    ys_new = np.interp(ys, knots_old, knots_new)
    band = (knots_old[2] - knots_old[0]) / 40
    p_old, p_new = profile(old, ys, band), profile(new, ys_new, band * (knots_new[2] - knots_new[0]) / (knots_old[2] - knots_old[0]))
    side = (new[:, 0] >= 0).astype(int)
    fitted = np.zeros_like(new)
    fitted[:, 1] = y
    for s in range(2):
        sel = side == s
        lo_x_o, hi_x_o, lo_z_o, hi_z_o = (np.interp(y[sel], ys, p_old[s, :, c]) for c in range(4))
        lo_x_n, hi_x_n, lo_z_n, hi_z_n = (np.interp(y[sel], ys, p_new[s, :, c]) for c in range(4))
        tx = (new[sel, 0] - lo_x_n) / np.maximum(1e-4, hi_x_n - lo_x_n)
        tz = (new[sel, 2] - lo_z_n) / np.maximum(1e-4, hi_z_n - lo_z_n)
        fitted[sel, 0] = lo_x_o + tx * (hi_x_o - lo_x_o)
        fitted[sel, 2] = lo_z_o + tz * (hi_z_o - lo_z_o)
    return fitted, side


def finish(j, binary, legs_mesh, old_prim, old, old_joints, old_weights, skin, skin_n, fitted, colour, index, side, label, name):
    # Over the skin: no vertex closer than 10 mm under / over the nearest body surface.
    from scipy.spatial import cKDTree
    body_tree = cKDTree(skin)
    _, near = body_tree.query(fitted)
    depth = np.einsum('ij,ij->i', fitted - skin[near], skin_n[near])
    sink = depth < .01
    fitted[sink] += skin_n[near[sink]] * (.01 - depth[sink])[:, None]

    # Skin weights from the nearest old-trousers vertex on the same leg (both legs at the waist).
    weights = np.zeros((len(fitted), 4))
    joints = np.zeros((len(fitted), 4), dtype=np.uint8)
    for s, sel_old in enumerate([old[:, 0] < 0, old[:, 0] >= 0]):
        tree = cKDTree(old[sel_old])
        sel = side == s
        _, k = tree.query(fitted[sel])
        src_i = np.nonzero(sel_old)[0][k]
        joints[sel] = old_joints[src_i]
        weights[sel] = old_weights[src_i]

    # Smooth normals over welded positions (seams keep one shading).
    keys = np.round(fitted / 1e-4).astype(np.int64)
    _, weld = np.unique(keys, axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    tri = index.reshape(-1, 3)
    face = np.cross(fitted[tri[:, 1]] - fitted[tri[:, 0]], fitted[tri[:, 2]] - fitted[tri[:, 0]])
    acc = np.zeros((weld.max() + 1, 3))
    for c in range(3):
        np.add.at(acc, weld[tri[:, c]], face)
    normal = acc[weld]
    normal /= np.maximum(1e-9, np.linalg.norm(normal, axis=1))[:, None]

    # ---- write: new buffer views appended, the legs primitive pointed at them ----
    def add(array, comp, typ, normalized=False, target=None, minmax=False):
        data = np.ascontiguousarray(array).tobytes()
        while len(binary) % 4:
            binary.append(0)
        view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
        if target:
            view['target'] = target
        binary.extend(data)
        j['bufferViews'].append(view)
        acc_ = {'bufferView': len(j['bufferViews']) - 1, 'componentType': comp, 'count': len(array), 'type': typ}
        if normalized:
            acc_['normalized'] = True
        if minmax:
            acc_['min'] = array.min(0).tolist(); acc_['max'] = array.max(0).tolist()
        j['accessors'].append(acc_)
        return len(j['accessors']) - 1

    q_weights = np.round(weights / np.maximum(1e-9, weights.sum(1, keepdims=True)) * 255).astype(np.int64)
    q_weights[np.arange(len(q_weights)), q_weights.argmax(1)] += 255 - q_weights.sum(1)
    attrs = {
        'POSITION': add(fitted.astype(np.float32), 5126, 'VEC3', target=34962, minmax=True),
        'NORMAL': add(np.round(normal * 127).astype(np.int8), 5120, 'VEC3', True, 34962),
        'COLOR_0': add(np.round(np.clip(colour, 0, 1) * 255).astype(np.uint8), 5121, 'VEC3', True, 34962),
        'JOINTS_0': add(joints.astype(np.uint8), 5121, 'VEC4', target=34962),
        'WEIGHTS_0': add(q_weights.astype(np.uint8), 5121, 'VEC4', True, 34962),
    }
    big = len(fitted) > 65535
    indices = add(index.astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', target=34963)
    old_prim['attributes'] = attrs
    old_prim['indices'] = indices
    mesh = j['meshes'][legs_mesh]
    mesh['name'] = name
    mesh['extras'] = {**mesh.get('extras', {}), 'part': name, 'label': label}
    j['materials'][old_prim['material']]['pbrMetallicRoughness']['roughnessFactor'] = .9
    j['buffers'][0]['byteLength'] = len(binary)

    payload = json.dumps(j, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload) % 4)
    while len(binary) % 4:
        binary.append(0)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(payload) + 8 + len(binary))
    out += struct.pack('<I', len(payload)) + b'JSON' + payload + struct.pack('<I', len(binary)) + b'BIN\x00' + bytes(binary)
    open(SURVIVOR, 'wb').write(out)
    print(f'{label}: {len(fitted)} vertices, {len(tri)} triangles, {int(sink.sum())} pushed out over the skin')


main()
