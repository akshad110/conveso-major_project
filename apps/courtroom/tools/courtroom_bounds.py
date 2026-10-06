"""World-space AABB for every node in the courtroom GLB."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lib import *

def node_world_aabbs(path):
    js, bin_ = load_glb(path)
    nodes = js['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    cache = {}
    def world(i):
        if i in cache: return cache[i]
        m = m4_from_node(nodes[i])
        p = parent.get(i)
        cache[i] = m4_mul(world(p), m) if p is not None else m
        return cache[i]
    out = {}
    for i, n in enumerate(nodes):
        if 'mesh' not in n: continue
        mesh = js['meshes'][n['mesh']]
        lo = [1e18]*3; hi = [-1e18]*3
        M = world(i)
        for prim in mesh['primitives']:
            pi = prim.get('attributes', {}).get('POSITION')
            if pi is None: continue
            a = js['accessors'][pi]
            if not (a.get('min') and a.get('max')): continue
            mn, mx = a['min'], a['max']
            for bx in range(2):
                for by in range(2):
                    for bz in range(2):
                        v = [mx[0] if bx else mn[0], mx[1] if by else mn[1], mx[2] if bz else mn[2]]
                        w = [M[r][0]*v[0] + M[r][1]*v[1] + M[r][2]*v[2] + M[r][3] for r in range(3)]
                        for k in range(3):
                            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
        if lo[0] > 1e17: continue
        out[n.get('name')] = dict(min=[round(v,3) for v in lo], max=[round(v,3) for v in hi],
                                 center=[round((lo[k]+hi[k])/2,3) for k in range(3)],
                                 size=[round(hi[k]-lo[k],3) for k in range(3)])
    return out

if __name__ == '__main__':
    a = node_world_aabbs(sys.argv[1])
    keys = sys.argv[2:] if len(sys.argv) > 2 else sorted(a)
    for k in keys:
        if k not in a: print(f"{k}: MISSING"); continue
        v = a[k]
        print(f"{k:34s} min={str(v['min']):26s} max={str(v['max']):26s} size={v['size']}")
