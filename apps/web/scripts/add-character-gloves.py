"""Puts a pair of gloves (a static, textured GLB such as a Sketchfab export) on the survivor's hands
(new slot `gloves` in models/characters/zion-survivor.glb), skinned to the hand and finger bones.

Each glove is fitted with a skeleton: the survivor's hand skeleton (wrist, the five finger chains and
their tips) is laid into the glove — turned and sized to it, each finger turned and stretched to the
glove finger found in the mesh — and every glove vertex is then carried from that skeleton onto the
real one by its place along the nearest bones (blended between the two nearest, so the knuckles bend
smoothly). The glove whose thumb lies on the same side as the hand's goes on that hand. Skin weights
come from the nearest skin of the same finger, and the glove is kept a little over the skin.

Afterwards copy the model to public/ (the hand skin under the gloves is left out by the game):
  cp models/characters/zion-survivor.glb apps/web/public/models/characters/
Usage (repo root): python apps/web/scripts/add-character-gloves.py <gloves.glb> [label]
"""
import importlib.util
import json
import os
import struct
import sys

import numpy as np
from scipy.spatial import cKDTree

_spec = importlib.util.spec_from_file_location('garment', os.path.join(os.path.dirname(__file__), 'replace-character-garment.py'))
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)

SURVIVOR = G.SURVIVOR
FINGERS = ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky']
RADIAL = float(os.environ.get('GLOVE_RADIAL', '1.25'))


def components(index, verts, keep):
    """Connected pieces of the mesh (positions welded) among the kept vertices."""
    keys = np.round(verts / 1e-5).astype(np.int64)
    _, weld = np.unique(keys, axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    parent = np.arange(weld.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    tri = index.reshape(-1, 3)
    for a, b, c in tri:
        if keep[a] and keep[b] and keep[c]:
            for x, y in ((a, b), (b, c)):
                ra, rb = find(weld[x]), find(weld[y])
                if ra != rb:
                    parent[ra] = rb
    roots = np.array([find(weld[i]) if keep[i] else -1 for i in range(len(verts))])
    out = [np.nonzero(roots == r)[0] for r in np.unique(roots[roots >= 0])]
    return sorted(out, key=len, reverse=True)


def glove_landmarks(p, index):
    """Cuff centre, the down axis, and the five finger pieces (thumb first, then index → pinky)."""
    centre = p.mean(0)
    _, _, vt = np.linalg.svd(p - centre, full_matrices=False)
    axis = vt[0]
    depth = (p - centre) @ axis
    # The fingers' end breaks up into separate pieces; the cuff's does not.
    def pieces(sign, f):
        d = depth * sign
        lo, hi = d.min(), d.max()
        keep = d > lo + (hi - lo) * f
        return [c for c in components(index, p, keep) if len(c) > len(p) * .004]
    best = None
    for sign in (1, -1):
        for f in np.arange(.5, .9, .01):
            got = pieces(sign, f)
            if len(got) == 5:
                best = (sign, f, got)
                break
        if best:
            break
    if not best:
        raise SystemExit('Could not find five fingers in a glove.')
    sign, f, fingers = best
    down = axis * sign
    d = (p - centre) @ down
    cuff = p[d < d.min() + (d.max() - d.min()) * .06].mean(0)
    tips = [p[c][np.argsort((p[c] - centre) @ down)[-6:]].mean(0) for c in fingers]
    reach = [((t - cuff) @ down) for t in tips]
    # Lateral order across the hand; the thumb is the end piece that reaches less far.
    lat_axis = tips[int(np.argmax(reach))] - cuff
    lat_axis = np.cross(down, np.cross(lat_axis, down))
    _, _, vt2 = np.linalg.svd(np.array(tips) - np.mean(tips, 0), full_matrices=False)
    lateral = vt2[0] - down * (vt2[0] @ down)
    lateral /= np.linalg.norm(lateral)
    order = np.argsort([(t - cuff) @ lateral for t in tips])
    ends = [order[0], order[-1]]
    thumb = ends[0] if reach[ends[0]] < reach[ends[1]] else ends[1]
    rest = [i for i in order if i != thumb]
    if thumb == order[-1]:
        rest = rest[::-1]
    ordered = [thumb] + rest
    return {'cuff': cuff, 'down': down, 'fingers': [fingers[i] for i in ordered], 'tips': [tips[i] for i in ordered], 'cut': f}


def hand_skeleton(bind, skin, dominant, side):
    """Wrist, each finger's joints and tip (from the skin at its end), and the forearm direction."""
    W = bind[f'hand_{side}']
    chains = []
    for f in FINGERS:
        js = [bind[f'{f}_0{k}_{side}'] for k in (1, 2, 3)]
        end = skin[dominant == f'{f}_03_{side}']
        along = js[2] - js[1]
        along /= np.linalg.norm(along)
        tip = js[2] + along * max(.005, ((end - js[2]) @ along).max())
        chains.append(js + [tip])
    elbow = bind[f'forearm_{side}']
    return W, chains, (W - elbow) / np.linalg.norm(W - elbow)


def frame(a, l):
    a = a / np.linalg.norm(a)
    l = l - a * (l @ a)
    l /= np.linalg.norm(l)
    return np.stack([a, l, np.cross(a, l)])


def rot_between(u, v):
    u = u / np.linalg.norm(u); v = v / np.linalg.norm(v)
    c = np.cross(u, v); s = np.linalg.norm(c); d = u @ v
    if s < 1e-9:
        return np.eye(3) if d > 0 else -np.eye(3)
    k = c / s
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + s * K + (1 - d) * K @ K


def fit(glove_p, L, W, chains, forearm_dir):
    """Glove vertices onto the hand: the hand skeleton laid into the glove, then each vertex carried
    from there to the real skeleton by its place along the two nearest bones."""
    knuckles = np.mean([c[0] for c in chains[1:]], 0)
    Fh = frame(knuckles - W, chains[4][0] - chains[1][0])
    Fg = frame(np.mean(L['tips'][1:], 0) - L['cuff'], L['tips'][4] - L['tips'][1])
    R = Fg.T @ Fh                       # hand directions → glove directions
    # Size: index-to-pinky tip spread, and wrist-to-middle-tip length, averaged.
    s = (np.linalg.norm(L['tips'][4] - L['tips'][1]) / np.linalg.norm(chains[4][3] - chains[1][3])
         + ((L['tips'][2] - L['cuff']) @ L['down']) / (np.linalg.norm(chains[2][3] - W) + .07)) / 2
    O = L['tips'][2] - s * R @ (chains[2][3] - W)
    to_glove = lambda x: O + s * R @ (x - W)
    # The skeleton in the glove, each finger turned and stretched to its glove finger.
    g_chains = []
    for fi, chain in enumerate(chains):
        pts = [to_glove(x) for x in chain]
        base, want = pts[0], L['tips'][fi]
        rot = rot_between(pts[3] - base, want - base)
        k = np.linalg.norm(want - base) / np.linalg.norm(pts[3] - base)
        g_chains.append([base + k * rot @ (q - base) for q in pts])
    gW = to_glove(W)
    cuff_len = max(.04, (gW - L['cuff']) @ (-L['down']) / s)
    segs_h, segs_g, owner = [], [], []
    segs_h.append((W, W - forearm_dir * cuff_len)); segs_g.append((gW, L['cuff'])); owner.append(('cuff', 0))
    for fi in range(5):
        segs_h.append((W, chains[fi][0])); segs_g.append((gW, g_chains[fi][0])); owner.append(('palm', fi))
        for k in range(3):
            segs_h.append((chains[fi][k], chains[fi][k + 1])); segs_g.append((g_chains[fi][k], g_chains[fi][k + 1])); owner.append((fi, k))
    A = np.array([a for a, _ in segs_g]); B = np.array([b for _, b in segs_g])
    AB = B - A
    t = np.einsum('vsk,sk->vs', glove_p[:, None, :] - A[None], AB) / np.maximum(1e-12, (AB * AB).sum(1))[None]
    tc = np.clip(t, 0, 1)
    dist = np.linalg.norm(glove_p[:, None, :] - (A[None] + tc[..., None] * AB[None]), axis=2)
    # Linear blend skinning from the glove's skeleton to the hand's: each bone carries the glove
    # rigidly (turned from its direction to the hand bone's, stretched to its length), and every
    # vertex mixes its bones by closeness (sharply), so the result stays continuous everywhere.
    Rinv = R.T / s
    M = []
    for (ha, hb), (ga, gb) in zip(segs_h, segs_g):
        u = (hb - ha) / np.linalg.norm(hb - ha)
        k = np.linalg.norm(hb - ha) / (np.linalg.norm(gb - ga) / s)
        # Across the bone a little fuller than the source (a glove sits over the skin, not in it).
        M.append((RADIAL * (np.eye(3) - np.outer(u, u)) + k * np.outer(u, u)) @ rot_between(Rinv @ (gb - ga), hb - ha) @ Rinv)
    M = np.array(M)
    Ha = np.array([a for a, _ in segs_h])
    moved = Ha[None] + np.einsum('sij,vsj->vsi', M, glove_p[:, None, :] - A[None])
    w = 1 / (dist ** 6 + 1e-18)
    w /= w.sum(1, keepdims=True)
    out = np.einsum('vs,vsi->vi', w, moved)
    best_owner = [owner[i] for i in np.argmin(dist, axis=1)]
    return out, best_owner


def main():
    args = sys.argv[1:]
    src, label = args[0], args[1] if len(args) > 1 else 'Tactical Gloves'
    j, binary = G.load(SURVIVOR)
    skin_def = j['skins'][0]
    names = [j['nodes'][i]['name'] for i in skin_def['joints']]
    ibm = G.read(j, binary, skin_def['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    bind = {n: np.linalg.inv(m)[:3, 3] for n, m in zip(names, ibm)}
    body_mesh = next(i for i, m in enumerate(j['meshes']) if m.get('extras', {}).get('slot') == 'body')
    if any(m.get('extras', {}).get('slot') == 'gloves' for m in j['meshes']):
        raise SystemExit('The survivor already wears gloves.')
    bp = j['meshes'][body_mesh]['primitives'][0]
    skin = G.read(j, binary, bp['attributes']['POSITION'])
    skin_n = G.read(j, binary, bp['attributes']['NORMAL']).astype(np.float64) / 127
    sj = G.read(j, binary, bp['attributes']['JOINTS_0']).astype(int)
    sw = G.read(j, binary, bp['attributes']['WEIGHTS_0']).astype(np.float64)
    dominant = np.array([names[sj[i, np.argmax(sw[i])]] for i in range(len(skin))])

    pos, colour, index, uv, maps = G.garment(src)
    # The two gloves: the two largest separate pieces.
    pieces = components(index, pos, np.ones(len(pos), bool))[:2]
    parts = []
    hands = {}
    for side in ('L', 'R'):
        W, chains, fdir = hand_skeleton(bind, skin, dominant, side)
        knuckles = np.mean([c[0] for c in chains[1:]], 0)
        F = frame(knuckles - W, chains[4][0] - chains[1][0])
        hands[side] = (W, chains, fdir, np.sign((chains[0][3] - knuckles) @ F[2]))
    used = set()
    for piece in pieces:
        sel = np.zeros(len(pos), bool); sel[piece] = True
        remap = -np.ones(len(pos), int); remap[piece] = np.arange(len(piece))
        tri = index.reshape(-1, 3)
        tri = tri[sel[tri].all(1)]
        p = pos[piece]
        L = glove_landmarks(p, remap[tri].reshape(-1))
        F = frame(np.mean(L['tips'][1:], 0) - L['cuff'], L['tips'][4] - L['tips'][1])
        parity = np.sign((L['tips'][0] - np.mean(L['tips'][1:], 0)) @ F[2])
        side = next((s for s in ('R', 'L') if s not in used and hands[s][3] == parity), next(s for s in ('R', 'L') if s not in used))
        used.add(side)
        W, chains, fdir, _ = hands[side]
        fitted, owner = fit(p, L, W, chains, fdir)
        parts.append((side, piece, remap[tri].reshape(-1), fitted, owner))
        print(f'glove -> hand {side}: cut {L["cut"]:.2f}, {len(piece)} vertices')

    # Skin weights from the nearest skin of the same finger (palm: the hand; cuff: the forearm).
    all_p, all_i, all_uv, all_c, all_j, all_w, offset = [], [], [], [], [], [], 0
    for side, piece, tri, fitted, owner in parts:
        groups = {}
        for v, o in enumerate(owner):
            key = 'cuff' if o[0] == 'cuff' else 'palm' if o[0] == 'palm' else FINGERS[o[0]]
            groups.setdefault(key, []).append(v)
        joints = np.zeros((len(fitted), 4), int); weights = np.zeros((len(fitted), 4))
        for key, vs in groups.items():
            if key == 'cuff':
                ok = np.isin(dominant, [f'forearm_{side}_001', f'forearm_{side}', f'hand_{side}'])
            elif key == 'palm':
                ok = np.isin(dominant, [f'hand_{side}'] + [f'{f}_01_{side}' for f in FINGERS])
            else:
                ok = np.isin(dominant, [f'{key}_0{k}_{side}' for k in (1, 2, 3)] + [f'hand_{side}'])
            ids = np.nonzero(ok)[0]
            _, k = cKDTree(skin[ids]).query(fitted[vs])
            joints[vs] = sj[ids[k]]; weights[vs] = sw[ids[k]]
        # A little over the skin of the hand.
        hand_ids = np.nonzero(np.char.find(dominant.astype(str), f'_{side}') >= 0)[0]
        tree = cKDTree(skin[hand_ids])
        _, k = tree.query(fitted)
        nn = hand_ids[k]
        depth = np.einsum('ij,ij->i', fitted - skin[nn], skin_n[nn])
        sink = depth < .0015
        fitted[sink] += skin_n[nn[sink]] * (.0015 - depth[sink])[:, None]
        print(f'  hand {side}: {int(sink.sum())} of {len(fitted)} vertices pushed out over the skin (median depth {np.median(depth) * 1000:.1f} mm)')
        all_p.append(fitted); all_i.append(tri + offset); all_uv.append(uv[piece]); all_c.append(colour[piece])
        all_j.append(joints); all_w.append(weights); offset += len(fitted)
    write(j, binary, np.concatenate(all_p), np.concatenate(all_i), np.concatenate(all_uv), np.concatenate(all_c),
          np.concatenate(all_j), np.concatenate(all_w), maps, label)


def write(j, binary, fitted, index, uv, colour, joints, weights, maps, label):
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

    def add(array, comp, typ, normalized=False, target=None, minmax=False):
        data = np.ascontiguousarray(array).tobytes()
        while len(binary) % 4:
            binary.append(0)
        view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
        if target:
            view['target'] = target
        binary.extend(data)
        j['bufferViews'].append(view)
        a = {'bufferView': len(j['bufferViews']) - 1, 'componentType': comp, 'count': len(array), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = array.min(0).tolist(); a['max'] = array.max(0).tolist()
        j['accessors'].append(a)
        return len(j['accessors']) - 1

    q = np.round(weights / np.maximum(1e-9, weights.sum(1, keepdims=True)) * 255).astype(np.int64)
    q[np.arange(len(q)), q.argmax(1)] += 255 - q.sum(1)
    attrs = {
        'POSITION': add(fitted.astype(np.float32), 5126, 'VEC3', target=34962, minmax=True),
        'NORMAL': add(np.round(normal * 127).astype(np.int8), 5120, 'VEC3', True, 34962),
        'COLOR_0': add(np.full((len(fitted), 3), 255, dtype=np.uint8), 5121, 'VEC3', True, 34962),
        'TEXCOORD_0': add(uv.astype(np.float32), 5126, 'VEC2', target=34962),
        'JOINTS_0': add(joints.astype(np.uint8), 5121, 'VEC4', target=34962),
        'WEIGHTS_0': add(q.astype(np.uint8), 5121, 'VEC4', True, 34962),
    }
    big = len(fitted) > 65535
    indices = add(index.astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', target=34963)
    j.setdefault('images', []); j.setdefault('textures', []); j.setdefault('samplers', [])
    if not j['samplers']:
        j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})

    def texture(entry):
        data, mime = entry
        while len(binary) % 4:
            binary.append(0)
        j['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary.extend(data)
        j['images'].append({'bufferView': len(j['bufferViews']) - 1, 'mimeType': mime})
        j['textures'].append({'sampler': 0, 'source': len(j['images']) - 1})
        return {'index': len(j['textures']) - 1}
    material = {'name': 'gloves', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': .85}}
    if maps.get('base'):
        material['pbrMetallicRoughness']['baseColorTexture'] = texture(maps['base'])
    if maps.get('normal'):
        material['normalTexture'] = texture(maps['normal'])
    if maps.get('ao'):
        material['occlusionTexture'] = texture(maps['ao'])
    j['materials'].append(material)
    lin = np.where(colour <= .04045, colour / 12.92, ((colour + .055) / 1.055) ** 2.4)
    j['meshes'].append({'name': 'gloves', 'primitives': [{'attributes': attrs, 'indices': indices, 'material': len(j['materials']) - 1}],
                        'extras': {'slot': 'gloves', 'part': 'gloves', 'label': label, 'mean': lin.mean(0).round(4).tolist()}})
    j['nodes'].append({'name': 'gloves', 'mesh': len(j['meshes']) - 1, 'skin': 0})
    j['scenes'][0]['nodes'].append(len(j['nodes']) - 1)
    G.compact(j, binary)
    payload = json.dumps(j, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload) % 4)
    while len(binary) % 4:
        binary.append(0)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(payload) + 8 + len(binary))
    out += struct.pack('<I', len(payload)) + b'JSON' + payload + struct.pack('<I', len(binary)) + b'BIN\x00' + bytes(binary)
    open(SURVIVOR, 'wb').write(out)
    print(f'{label}: {len(fitted)} vertices, {len(tri)} triangles')


if __name__ == '__main__':
    main()
