# Splits the hair packs (Sketchfab GLBs of Source-style hair rigs: bip_spine_1 > bip_neck > bip_head
# > strand bones) into one GLB per hairstyle, unchanged (meshes, textures, skin and strand bones as
# they come), so the game loads only the styles it shows.
# Usage: blender -b -P apps/web/scripts/split-hair-pack.py -- <out dir> <pack.glb>...
import bpy, sys, os, json

argv = sys.argv[sys.argv.index('--') + 1:]
out_dir, packs = argv[0], argv[1:]
os.makedirs(out_dir, exist_ok=True)
index = []
n = 0
for pack_no, pack in enumerate(packs, 1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=pack)
    arms = sorted([o for o in bpy.data.objects if o.type == 'ARMATURE'], key=lambda o: o.name)
    for arm in arms:
        meshes = [o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == arm or any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers))]
        if not meshes:
            continue
        n += 1
        style = f'hair_{n:02d}'
        bpy.ops.object.select_all(action='DESELECT')
        # The armature's own parents (the import's empties) carry the pack's axis and placement.
        p = arm
        while p:
            p.select_set(True)
            p = p.parent
        for m in meshes:
            m.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, style + '.glb'), export_format='GLB', use_selection=True,
                                  export_skins=True, export_animations=False, export_image_format='AUTO', export_yup=True)
        index.append({'id': style, 'pack': pack_no, 'source': arm.name, 'meshes': [m.name for m in meshes], 'verts': sum(len(m.data.vertices) for m in meshes)})
        print('exported', style, arm.name, len(meshes))
with open(os.path.join(out_dir, 'styles.json'), 'w') as f:
    json.dump(index, f, indent=1)
