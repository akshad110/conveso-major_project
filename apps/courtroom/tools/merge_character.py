"""
Merge a Meshy-AI character export (one GLB per animation clip) into a single GLB
that holds the skinned mesh + textures ONCE plus every animation clip, renamed
to a semantic name.

Nothing about the mesh, skeleton, materials or the animation curves themselves is
altered -- animation accessors are copied byte-for-byte and channels are retargeted
by bone NAME so the merge is safe even if node ordering differs between exports.

Usage:  python3 merge_character.py <out.glb> <base.glb=NAME> [<other.glb=NAME> ...]
"""
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lib import load_glb, save_glb, accessor_bytes, read_accessor, NUM, COMP

MIN_DURATION = 0.5   # drop Meshy's 2-frame T-pose stub clips


def clip_duration(js, bin_, anim):
    d = 0.0
    for s in anim.get('samplers', []):
        a = js['accessors'][s['input']]
        if a.get('max'):
            d = max(d, a['max'][0])
        else:
            times = read_accessor(js, bin_, s['input'])
            if times:
                d = max(d, times[-1][0])
    return d


def pad4(buf):
    while len(buf) % 4:
        buf += b'\x00'
    return buf


class Merger:
    def __init__(self, base_path):
        self.js, self.bin = load_glb(base_path)
        assert self.js['buffers'][0].get('uri') is None, 'base buffer must be GLB-embedded'
        self.js.setdefault('animations', [])
        self.node_index = {n.get('name'): i for i, n in enumerate(self.js['nodes'])}
        self.report = []

    # --- copy one accessor from a source document into this one -------------
    def copy_accessor(self, sjs, sbin, idx):
        src = sjs['accessors'][idx]
        raw = accessor_bytes(sjs, sbin, idx)
        self.bin = bytearray(pad4(bytes(self.bin)))
        offset = len(self.bin)
        self.bin += raw
        self.js['bufferViews'].append({
            'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw),
        })
        acc = {
            'bufferView': len(self.js['bufferViews']) - 1,
            'componentType': src['componentType'],
            'count': src['count'],
            'type': src['type'],
        }
        for k in ('min', 'max', 'normalized'):
            if k in src:
                acc[k] = src[k]
        self.js['accessors'].append(acc)
        return len(self.js['accessors']) - 1

    def add_clip(self, sjs, sbin, anim, name):
        smap = {}
        samplers = []
        for si, s in enumerate(anim['samplers']):
            smap[si] = len(samplers)
            samplers.append({
                'input': self.copy_accessor(sjs, sbin, s['input']),
                'output': self.copy_accessor(sjs, sbin, s['output']),
                'interpolation': s.get('interpolation', 'LINEAR'),
            })
        channels = []
        dropped = 0
        for ch in anim['channels']:
            tgt = ch.get('target', {})
            if 'node' not in tgt:
                continue
            bone = sjs['nodes'][tgt['node']].get('name')
            if bone not in self.node_index:      # retarget by name
                dropped += 1
                continue
            channels.append({
                'sampler': smap[ch['sampler']],
                'target': {'node': self.node_index[bone], 'path': tgt['path']},
            })
        self.js['animations'].append({'name': name, 'samplers': samplers, 'channels': channels})
        self.report.append((name, len(channels), dropped))
        return dropped

    def finish(self, out_path):
        self.js['buffers'][0]['byteLength'] = len(self.bin)
        self.js.setdefault('asset', {})['generator'] = \
            'courtroom-sim clip merger (mesh + curves copied verbatim from Meshy AI exports)'
        save_glb(out_path, self.js, self.bin)


def merge(out_path, pairs):
    base_path, base_name = pairs[0]
    m = Merger(base_path)
    base_anims = m.js['animations']
    m.js['animations'] = []          # re-add the base clips through the same path
    bjs, bbin = m.js, m.bin
    total_dropped = 0
    for path, name in pairs:
        sjs, sbin = load_glb(path)
        kept = 0
        for anim in sjs.get('animations', []):
            if clip_duration(sjs, sbin, anim) < MIN_DURATION:
                continue
            total_dropped += m.add_clip(sjs, sbin, anim, name)
            kept += 1
            break                    # exactly one real clip per Meshy file
        if kept == 0:
            print(f'  !! no usable clip in {os.path.basename(path)}')
    m.finish(out_path)
    return m, total_dropped


if __name__ == '__main__':
    out = sys.argv[1]
    pairs = []
    for arg in sys.argv[2:]:
        p, _, n = arg.rpartition('=')
        pairs.append((p, n))
    m, dropped = merge(out, pairs)
    size = os.path.getsize(out) / 1e6
    print(f'{os.path.basename(out)}  {size:.1f} MB  {len(m.report)} clips')
    for name, nch, dr in m.report:
        print(f'    {name:20s} {nch:3d} channels' + (f'  ({dr} unmatched bones dropped)' if dr else ''))
    if dropped:
        print(f'  WARNING: {dropped} channels dropped (bone name mismatch)')
