#!/usr/bin/env python3
"""Build lightweight, named-layer GLB assets for the VERA demo projects.
All dimensions are conceptual metres, not construction/BIM data.
"""
import json, os, struct

MATERIALS = [
    ("plaster", [0.82, 0.79, 0.72, 1], 0.0, 0.88),
    ("concrete", [0.58, 0.56, 0.51, 1], 0.0, 0.92),
    ("wood", [0.40, 0.25, 0.14, 1], 0.0, 0.62),
    ("glass", [0.35, 0.58, 0.60, 0.42], 0.12, 0.12),
    ("metal", [0.24, 0.27, 0.23, 1], 0.72, 0.32),
    ("green", [0.28, 0.38, 0.24, 1], 0.0, 0.95),
]
MATERIAL_ID = {item[0]: i for i, item in enumerate(MATERIALS)}

def make_project(kind, width, depth, height, output_path):
    nodes = []
    def box(layer, name, x, y, z, sx, sy, sz, material):
        nodes.append({
            "name": f"{layer}_{name}", "mesh": MATERIAL_ID[material],
            "translation": [round(x, 3), round(y, 3), round(z, 3)],
            "scale": [round(sx, 3), round(sy, 3), round(sz, 3)]
        })

    w, d, h = width, depth, height
    t, wall_h = max(0.16, w * 0.012), h * 0.78
    box("site", "base", 0, -0.28, 0, w*1.42, 0.28, d*1.42, "concrete")
    box("structure", "floor", 0, 0, 0, w, 0.22, d, "concrete")
    box("structure", "left", -w/2+t/2, wall_h/2, 0, t, wall_h, d, "plaster")
    box("structure", "right", w/2-t/2, wall_h/2, 0, t, wall_h, d, "plaster")
    box("structure", "rear", 0, wall_h/2, -d/2+t/2, w, wall_h, t, "plaster")
    box("structure", "front-left", -w*.34, wall_h/2, d/2-t/2, w*.32, wall_h, t, "plaster")
    box("structure", "front-right", w*.37, wall_h/2, d/2-t/2, w*.26, wall_h, t, "plaster")

    if kind == "villa":
        box("structure", "suite", w*.18, wall_h*.4, -d*.18, t, wall_h*.8, d*.58, "plaster")
        box("structure", "service", -w*.27, wall_h*.35, -d*.22, w*.34, wall_h*.7, t, "concrete")
        box("structure", "terrace-edge", 0, .52, d*.58, w*.72, .95, .16, "concrete")
        for i in range(5):
            box("structure", f"pergola-{i}", -w*.3+i*w*.15, h*.88, d*.62, .1, .12, d*.38, "wood")
    elif kind == "gallery":
        box("structure", "gallery-core-left", -w*.27, wall_h*.4, 0, t, wall_h*.8, d*.62, "concrete")
        box("structure", "gallery-core-right", w*.25, wall_h*.4, -d*.2, t, wall_h*.8, d*.55, "concrete")
        box("structure", "reception-partition", 0, wall_h*.28, d*.25, w*.42, wall_h*.56, t, "plaster")
    elif kind == "serenity":
        box("structure", "bedroom-partition", -w*.12, wall_h*.42, -d*.13, t, wall_h*.84, d*.58, "concrete")
        box("structure", "bath-partition", w*.2, wall_h*.34, -d*.28, w*.28, wall_h*.68, t, "concrete")
    else:
        box("structure", "study-partition", w*.2, wall_h*.4, -d*.15, t, wall_h*.8, d*.52, "plaster")
        box("structure", "bedroom-partition", -w*.24, wall_h*.35, -d*.25, w*.4, wall_h*.7, t, "plaster")

    glass_h, glass_y = wall_h*.66, wall_h*.45
    box("glass", "front-glazing", -w*.22, glass_y, d/2-t*.65, w*.4, glass_h, .055, "glass")
    box("glass", "rear-glazing", w*.22, glass_y, -d/2+t*.65, w*.42, glass_h, .055, "glass")
    for i in range(4):
        box("glass", f"mullion-{i}", -w*.36+i*w*.24, glass_y, d/2-t*.55, .045, glass_h+.04, .08, "metal")
    box("roof", "roof", 0, wall_h+.16, 0, w+.3, .28, d+.3, "concrete")

    if kind == "gallery":
        box("furniture", "reception-desk", -w*.22, .55, d*.2, w*.25, 1.1, d*.12, "wood")
        for i in range(3):
            box("furniture", f"display-{i}", -w*.25+i*w*.25, .5, -d*.12, w*.1, 1, d*.1, "plaster")
        box("furniture", "conference-table", w*.24, .72, -d*.28, w*.28, .12, d*.15, "wood")
    else:
        box("furniture", "sofa-base", -w*.2, .34, d*.2, w*.24, .34, d*.105, "wood")
        box("furniture", "sofa-cushion", -w*.2, .55, d*.2, w*.22, .12, d*.10, "plaster")
        box("furniture", "sofa-back", -w*.2, .72, d*.145, w*.24, .62, .10, "plaster")
        box("furniture", "coffee-table", w*.03, .38, d*.04, w*.17, .10, d*.12, "wood")
        box("furniture", "bed", w*.28, .36, -d*.22, w*.2, .56, d*.18, "plaster")
        box("furniture", "kitchen-island", -w*.12, .5, -d*.28, w*.22, .95, d*.12, "plaster")
        box("furniture", "dining-table", w*.03, .76, -d*.02, w*.18, .10, d*.14, "wood")

    box("site", "path", 0, -.10, d*.63, w*.34, .08, d*.22, "concrete")
    for i in range(3):
        x = -w*.42+i*w*.42
        box("site", f"planter-{i}", x, .12, d*.63, w*.1, .24, d*.12, "concrete")
        box("site", f"tree-{i}", x, 1.35, d*.63, .72, 1.35, .72, "green")

    faces = [
        ((1,0,0),[(.5,-.5,-.5),(.5,.5,-.5),(.5,.5,.5),(.5,-.5,.5)]),
        ((-1,0,0),[(-.5,-.5,.5),(-.5,.5,.5),(-.5,.5,-.5),(-.5,-.5,-.5)]),
        ((0,1,0),[(-.5,.5,-.5),(-.5,.5,.5),(.5,.5,.5),(.5,.5,-.5)]),
        ((0,-1,0),[(-.5,-.5,.5),(-.5,-.5,-.5),(.5,-.5,-.5),(.5,-.5,.5)]),
        ((0,0,1),[(-.5,-.5,.5),(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5)]),
        ((0,0,-1),[(.5,-.5,-.5),(-.5,-.5,-.5),(-.5,.5,-.5),(.5,.5,-.5)])
    ]
    vertices, normals, indices = [], [], []
    for normal, quad in faces:
        start = len(vertices)
        vertices.extend(quad)
        normals.extend([normal]*4)
        indices.extend([start,start+1,start+2,start,start+2,start+3])

    binary, views, accessors = bytearray(), [], []
    def add_accessor(data, component_type, data_type, count, target=None, minimum=None, maximum=None):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(data)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        view_index = len(views)
        views.append(view)
        accessor = {"bufferView": view_index, "componentType": component_type, "count": count, "type": data_type}
        if minimum is not None:
            accessor["min"], accessor["max"] = minimum, maximum
        accessor_index = len(accessors)
        accessors.append(accessor)
        return accessor_index

    pos = b"".join(struct.pack("<3f", *v) for v in vertices)
    nor = b"".join(struct.pack("<3f", *v) for v in normals)
    idx = b"".join(struct.pack("<H", v) for v in indices)
    pos_acc = add_accessor(pos, 5126, "VEC3", 24, 34962, [-.5]*3, [.5]*3)
    nor_acc = add_accessor(nor, 5126, "VEC3", 24, 34962)
    idx_acc = add_accessor(idx, 5123, "SCALAR", 36, 34963)

    meshes = []
    for i, item in enumerate(MATERIALS):
        meshes.append({"name": item[0], "primitives": [{
            "attributes": {"POSITION": pos_acc, "NORMAL": nor_acc},
            "indices": idx_acc, "material": i
        }]})
    document = {
        "asset": {"version": "2.0", "generator": "Alishams VERA GLB Studio",
                  "extras": {"project": kind, "units": "meters", "modelType": "conceptual architectural visualization"}},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes,
        "materials": [
            {"name": name, "pbrMetallicRoughness": {
                "baseColorFactor": color, "metallicFactor": metallic, "roughnessFactor": roughness
            }, **({"alphaMode": "BLEND", "doubleSided": True} if name == "glass" else {})}
            for name, color, metallic, roughness in MATERIALS
        ],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views, "accessors": accessors
    }
    json_chunk = json.dumps(document, separators=(",", ":")).encode("utf-8")
    while len(json_chunk) % 4:
        json_chunk += b" "
    while len(binary) % 4:
        binary.append(0)
    total_length = 12 + 8 + len(json_chunk) + 8 + len(binary)
    glb = (struct.pack("<4sII", b"glTF", 2, total_length)
           + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
           + struct.pack("<I4s", len(binary), b"BIN\0") + binary)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as handle:
        handle.write(glb)
    print(f"Built {output_path}: {len(glb)} bytes, {len(nodes)} named components")

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target = os.path.join(root, "assets", "vera")
    projects = [
        ("serenity", 14.4, 10.8, 3.2, "serenity-house.glb"),
        ("villa", 21, 20, 3.6, "line-and-light-villa.glb"),
        ("gallery", 15, 12, 4.2, "living-gallery.glb"),
        ("bright", 12, 9.6, 3.1, "bright-house.glb"),
    ]
    for kind, width, depth, height, filename in projects:
        make_project(kind, width, depth, height, os.path.join(target, filename))

if __name__ == "__main__":
    main()
