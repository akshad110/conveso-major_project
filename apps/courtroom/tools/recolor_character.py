"""
Re-skin an already-built character GLB onto a newly textured export.

The Meshy colour packs the user supplies carry the same character, rigged the
same way, but with the material and textures the earlier export was missing.
They arrive as one GLB per clip with opaque UUID names, so they cannot simply
replace a character file that already has twelve correctly identified clips.

This takes the mesh, skeleton, materials and textures from the COLOURED export
and the animation curves -- with the semantic names already derived by motion
analysis -- from the BUILT character. Nothing is renamed and nothing is guessed:
every clip keeps the name it was given when its motion was measured.

Channels are retargeted by bone NAME, so the two exports may order their nodes
differently. If a bone in the clip source has no counterpart in the coloured
base the channel is dropped and reported -- a non-zero drop count means the two
files are not the same rig and the result must not be shipped.

Usage:  python3 recolor_character.py <out.glb> <coloured_base.glb> <clips_source.glb>
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lib import load_glb
from merge_character import Merger, clip_duration, MIN_DURATION


def recolor(out_path, base_path, clips_path):
    m = Merger(base_path)
    m.js['animations'] = []          # the base's UUID-named stubs are not wanted
    sjs, sbin = load_glb(clips_path)
    total_dropped = 0
    for anim in sjs.get('animations', []):
        name = anim.get('name')
        if not name:
            continue
        if clip_duration(sjs, sbin, anim) < MIN_DURATION:
            print(f'  .. skipping {name}: shorter than {MIN_DURATION}s')
            continue
        total_dropped += m.add_clip(sjs, sbin, anim, name)
    m.finish(out_path)
    return m, total_dropped


if __name__ == '__main__':
    out, base, clips = sys.argv[1], sys.argv[2], sys.argv[3]
    m, dropped = recolor(out, base, clips)
    size = os.path.getsize(out) / 1e6
    print(f'{os.path.basename(out)}  {size:.1f} MB  {len(m.report)} clips')
    for name, nch, dr in m.report:
        print(f'    {name:20s} {nch:3d} channels' + (f'  ({dr} unmatched bones dropped)' if dr else ''))
    if dropped:
        print(f'  WARNING: {dropped} channels dropped -- rigs do not match, do not ship')
        sys.exit(1)
