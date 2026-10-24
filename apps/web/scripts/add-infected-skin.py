"""Adds the infection mode's zombie (a static, textured GLB) to models/characters/zion-survivor.glb as
the extra part `infected`, skinned to the survivor's skeleton so it plays every player animation.

The survivor's bind pose holds the arms low at the sides; the zombie model reaches forward. So the
survivor's arms are first turned (in a copy of the pose) to point where the zombie's hands are, the
zombie is scaled onto the survivor's height, and each zombie vertex takes the skin weights of the
nearest survivor skin vertex in that pose. It is then moved back into the bind pose through the
inverse of its own blended skinning transform, so in the bind pose its arms hang like the body's.

Afterwards rebuild the hidden skin and copy the model to public/ (see replace-character-garment.py).
Usage (repo root): python apps/web/scripts/add-infected-skin.py <zombie.glb>
"""
import importlib.util
import json
import struct
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

spec = importlib.util.spec_from_file_location('garment', Path(__file__).with_name('replace-character-garment.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


def rotation_between(a, b):
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), np.dot(a, b)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1 / (1 + c))


def main():
    src = sys.argv[1]
    j, binary = g.load(g.SURVIVOR)
    if any(m.get('extras', {}).get('slot') == 'infected' for m in j['meshes']):
        sys.exit('the survivor already has an infected part')
    skin = j['skins'][0]
    joints = skin['joints']
    ibm = g.read(j, binary, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    parents = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}
    local = {i: g.node_matrix(j['nodes'][i]) for i in range(len(j['nodes']))}

    def world(i):
        return world(parents[i]) @ local[i] if i in parents else local[i]

    index_of = {j['nodes'][n]['name']: n for n in joints}
    pos = lambda name: world(index_of[name])[:3, 3]

    body_mesh = next(i for i, m in enumerate(j['meshes']) if m.get('extras', {}).get('slot') == 'body')
    prim = j['meshes'][body_mesh]['primitives'][0]
    body = g.read(j, binary, prim['attributes']['POSITION'])
    body_joints = g.read(j, binary, prim['attributes']['JOINTS_0']).astype(int)
    body_weights = g.read(j, binary, prim['attributes']['WEIGHTS_0']).astype(np.float64)
    body_weights /= np.maximum(1e-9, body_weights.sum(1, keepdims=True))

    zombie, colour, index, uv, maps = g.garment(src)
    # Onto the survivor's height, feet on its feet, centred on it.
    s = (body[:, 1].max() - body[:, 1].min()) / (zombie[:, 1].max() - zombie[:, 1].min())
    zombie = (zombie - np.array([(zombie[:, 0].min() + zombie[:, 0].max()) / 2, zombie[:, 1].min(), (zombie[:, 2].min() + zombie[:, 2].max()) / 2])) * s
    zombie += np.array([0, body[:, 1].min(), (body[:, 2].min() + body[:, 2].max()) / 2])

    # The survivor's arms turned to the zombie's hands (each arm straightened, pointing at the
    # zombie's farthest point on that side).
    for side, sign in (('L', 1), ('R', -1)):
        shoulder = pos(f'upper_arm_{side}')
        # The arm: out past the shoulder, above the hips (not the feet).
        reach = zombie[(zombie[:, 0] * sign > abs(shoulder[0]) + .05) & (zombie[:, 1] > body[:, 1].min() + (body[:, 1].max() - body[:, 1].min()) * .5)]
        tip = reach[np.argmax(np.linalg.norm(reach - shoulder, axis=1))]
        for bone, towards in ((f'upper_arm_{side}', f'hand_{side}'), (f'forearm_{side}', f'hand_{side}')):
            i = index_of[bone]
            r = rotation_between(pos(towards) - pos(bone), tip - pos(bone))
            w = world(i)
            turned = w.copy(); turned[:3, :3] = r @ w[:3, :3]
            parent = world(parents[i]) if i in parents else np.eye(4)
            local[i] = np.linalg.inv(parent) @ turned
    skinning = np.stack([world(n) @ ibm[k] for k, n in enumerate(joints)])

    def blend(js, ws):
        return np.einsum('vk,vkab->vab', ws, skinning[js])

    posed = np.einsum('vab,vb->va', blend(body_joints, body_weights), np.c_[body, np.ones(len(body))])[:, :3]
    # Weights from the nearby skin (8 nearest, by distance), then evened out along the mesh so
    # loose cloth and fingers do not tear between bones.
    dist, near = cKDTree(posed).query(zombie, k=8)
    full = np.zeros((len(zombie), len(joints)), dtype=np.float32)
    inv = 1 / np.maximum(1e-4, dist) ** 2
    for k in range(8):
        np.add.at(full, (np.arange(len(zombie))[:, None].repeat(4, 1), body_joints[near[:, k]]), body_weights[near[:, k]] * inv[:, k:k + 1])
    keys = np.round(zombie / 1e-4).astype(np.int64)
    _, weld = np.unique(keys, axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    tri = index.reshape(-1, 3)
    edges = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    edges = weld[edges]
    for _ in range(4):
        merged = np.zeros((weld.max() + 1, full.shape[1]), dtype=np.float32)
        np.add.at(merged, weld, full)
        merged /= np.maximum(1e-9, merged.sum(1, keepdims=True))
        acc = merged.copy()
        np.add.at(acc, edges[:, 0], merged[edges[:, 1]])
        np.add.at(acc, edges[:, 1], merged[edges[:, 0]])
        full = (acc / np.maximum(1e-9, acc.sum(1, keepdims=True)))[weld]
    js = np.argsort(-full, axis=1)[:, :4]
    ws = np.take_along_axis(full, js, 1).astype(np.float64)
    ws /= np.maximum(1e-9, ws.sum(1, keepdims=True))
    inverse = np.linalg.inv(blend(js, ws))
    bind = np.einsum('vab,vb->va', inverse, np.c_[zombie, np.ones(len(zombie))])[:, :3]

    # Normals from the faces in the bind pose, welded over seams.
    keys = np.round(bind / 1e-4).astype(np.int64)
    _, weld = np.unique(keys, axis=0, return_inverse=True)
    weld = weld.reshape(-1)
    tri = index.reshape(-1, 3)
    face = np.cross(bind[tri[:, 1]] - bind[tri[:, 0]], bind[tri[:, 2]] - bind[tri[:, 0]])
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

    q = np.round(ws * 255).astype(np.int64)
    q[np.arange(len(q)), q.argmax(1)] += 255 - q.sum(1)
    big = len(bind) > 65535
    primitive = {
        'attributes': {
            'POSITION': add(bind.astype(np.float32), 5126, 'VEC3', target=34962, minmax=True),
            'NORMAL': add(np.round(normal * 127).astype(np.int8), 5120, 'VEC3', True, 34962),
            'COLOR_0': add(np.full((len(bind), 3), 255, dtype=np.uint8), 5121, 'VEC3', True, 34962),
            'TEXCOORD_0': add(uv.astype(np.float32), 5126, 'VEC2', target=34962),
            'JOINTS_0': add(js.astype(np.uint8), 5121, 'VEC4', target=34962),
            'WEIGHTS_0': add(q.astype(np.uint8), 5121, 'VEC4', True, 34962),
        },
        'indices': add(index.astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', target=34963),
        'material': len(j['materials']),
    }
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
    material = {'name': 'infected', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': .85}}
    if maps.get('base'):
        material['pbrMetallicRoughness']['baseColorTexture'] = texture(maps['base'])
    if maps.get('normal'):
        material['normalTexture'] = texture(maps['normal'])
    if maps.get('ao'):
        material['occlusionTexture'] = texture(maps['ao'])
    j['materials'].append(material)
    lin = np.where(colour <= .04045, colour / 12.92, ((colour + .055) / 1.055) ** 2.4)
    j['meshes'].append({'name': 'infected', 'extras': {'part': 'infected', 'slot': 'infected', 'label': 'Infected', 'mean': lin.mean(0).round(4).tolist()}, 'primitives': [primitive]})
    body_node = next(n for n in j['nodes'] if n.get('mesh') == body_mesh)
    j['nodes'].append({'name': 'infected', 'mesh': len(j['meshes']) - 1, 'skin': body_node['skin']})
    j['scenes'][0]['nodes'].append(len(j['nodes']) - 1)
    g.compact(j, binary)

    payload = json.dumps(j, separators=(',', ':')).encode()
    payload += b' ' * (-len(payload) % 4)
    while len(binary) % 4:
        binary.append(0)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(payload) + 8 + len(binary))
    out += struct.pack('<I', len(payload)) + b'JSON' + payload + struct.pack('<I', len(binary)) + b'BIN\x00' + bytes(binary)
    open(g.SURVIVOR, 'wb').write(out)
    print(f'infected: {len(bind)} vertices, {len(tri)} triangles')


if __name__ == '__main__':
    main()
