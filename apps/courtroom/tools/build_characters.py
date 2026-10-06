"""
Build the runtime character GLBs for the courtroom simulator.

Reads the original Meshy AI exports (one GLB per clip) out of the asset folder and
writes one merged GLB per character into the app's public/models directory.

Clip identity was determined by forward-kinematics motion analysis of the actual
curves (hip height, root travel, hand path length, head yaw/pitch), NOT by guessing
from names -- the source clips are named with opaque UUIDs. See CLIP_IDENTITY below.
"""
import os, sys, glob, zipfile, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from merge_character import merge

# --- what each Meshy animation UUID actually is -------------------------------
# Derived from motion analysis. Values in metres, character ~1.70 m tall.
CLIP_IDENTITY = {
    '01a06239-13bd': ('SIT_WRITE',        'hips 0.8->0.5, head pitch -77deg, settles seated looking down at desk'),
    '01a06248-2d1f': ('SIT_IDLE',         'hips flat 0.50, head 1.00, zero limb motion - seated at rest'),
    '01a06248-fd82': ('STAND_UP',         'hips 0.50 -> 0.90 over first 15%, then holds standing'),
    '01a06249-cc7c': ('SIT_DOWN',         'hips 0.90 -> 0.50, head 1.4 -> 0.9, hands lower to desk'),
    '01a0624a-8842': ('STAND_IDLE',       'hips 0.80, zero limb motion - standing at rest'),
    '01a0624b-77ca': ('SPEAK_GESTURE',    'standing, left hand peaks 1.4, both hands active - animated talking'),
    '01a0624c-21d1': ('SPEAK',            'standing, low head motion, one hand held at 1.0 - calm address'),
    '01a0624d-2e9a': ('OBJECTION',        'standing, RIGHT hand spikes to 1.6 (above head) - raised arm'),
    '01a0624d-c6c4': ('PRESENT_EVIDENCE', 'standing, right hand held 1.3 for ~4s, head turns 106deg to address'),
    '01a06256-c38f': ('REACT',            'standing, both hands rise together, head down -30deg, yaw sweeps -41..+65'),
    '01a0625e-311d': ('STAND_IDLE',       'standing, dead still - breathing idle'),
    '01a0625f-c2cd': ('LISTEN',           'standing, still, slow forward head dip -10deg - attentive'),
    '01a06262-4390': ('STAND_IDLE_ALT',   'standing, near-zero motion - cleanest neutral idle'),
    '01a06263-43e3': ('NOD',              'pitch oscillates +1/-4.8/+4.4 with flat yaw - vertical head nod'),
    '01a06263-e489': ('SHAKE_HEAD',       'yaw sweeps 0->+30->+9 with pitch -19 - lateral head shake / turn away'),
    '01a066e9-b37c': ('WALK_FORWARD',     'root travels 2.6 m net - walk WITH root motion, for escorting'),
    'Walking_Woman': ('WALK',             'in-place walk loop, 1.00 s, feminine gait'),
    'Walking':       ('WALK',             'in-place walk loop, 1.07 s'),
    'Running':       ('RUN',              'in-place run loop, 0.67 s'),
}

# --- character -> source zip -------------------------------------------------
CHARACTERS = {
    # Ships only 3 clips (SIT_WRITE / Walking / Running) -- motion-identical curves
    # to the clerk export. No gavel, speak, seated idle or posture transitions, so
    # the judge leans on DERIVED_CLIPS in src/config/animationMap.js.
    'judge':           'Judge_with_animation .zip',
    'prosecutor':      'prosecutor_with_animations.zip',
    'defense':         'defendant_with_animataion.zip',   # same base mesh, confirmed = Defense
    'witness_male':    'witness_with_animation.zip',
    'witness_female':  'female witness.zip',
    'defendant_male':  'accused.zip',
    'defendant_female':'Female Accused .zip',
    'clerk':           'clerk with animation .zip',
    'police':          'police officer female .zip',
}

# STAND_IDLE wins over WALK etc. as the base file; keeps the default pose sane.
BASE_PREFERENCE = ['STAND_IDLE', 'SIT_IDLE', 'STAND_IDLE_ALT', 'SIT_WRITE', 'LISTEN', 'WALK']


def identify(filename):
    for key, (name, _why) in CLIP_IDENTITY.items():
        if key in filename:
            return name
    return None


def main(assets_dir, out_dir, work_dir, only=None):
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(work_dir, exist_ok=True)
    summary = {}

    for char, zip_name in CHARACTERS.items():
        if only and char not in only:
            continue
        if zip_name is None:
            print(f'\n== {char}: no source asset, skipped')
            summary[char] = None
            continue
        zip_path = os.path.join(assets_dir, zip_name)
        if not os.path.exists(zip_path):
            print(f'\n== {char}: MISSING {zip_name}')
            summary[char] = None
            continue

        stage = os.path.join(work_dir, char)
        if os.path.isdir(stage):
            shutil.rmtree(stage)
        os.makedirs(stage)
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(stage)

        files = sorted(glob.glob(os.path.join(stage, '**', '*.glb'), recursive=True))
        pairs, unknown = [], []
        for f in files:
            name = identify(os.path.basename(f))
            if name is None:
                unknown.append(os.path.basename(f))
                continue
            pairs.append((f, name))

        # de-duplicate semantic names (e.g. police ships Walking AND Walking_Woman)
        seen, deduped = {}, []
        for f, name in pairs:
            if name in seen:
                alt = name + '_ALT'
                i = 2
                while alt in seen:
                    alt = f'{name}_ALT{i}'; i += 1
                name = alt
            seen[name] = f
            deduped.append((f, name))

        order = {n: i for i, n in enumerate(BASE_PREFERENCE)}
        deduped.sort(key=lambda p: order.get(p[1], 99))

        print(f'\n== {char}  ({len(deduped)} clips from {zip_name})')
        if unknown:
            print(f'   unidentified source files: {unknown}')
        out = os.path.join(out_dir, f'{char}.glb')
        m, dropped = merge(out, deduped)
        before = sum(os.path.getsize(f) for f, _ in deduped) / 1e6
        after = os.path.getsize(out) / 1e6
        print(f'   {before:.1f} MB -> {after:.1f} MB   clips: '
              + ', '.join(n for n, _c, _d in m.report))
        if dropped:
            print(f'   WARNING {dropped} channels dropped')
        summary[char] = [n for n, _c, _d in m.report]

    print('\n=== clip inventory ===')
    for char, clips in summary.items():
        print(f'{char:18s} {clips if clips else "-- no asset --"}')
    return summary


if __name__ == '__main__':
    # build_characters.py <assets_dir> <out_dir> [work_dir] [char ...]
    argv = sys.argv[1:]
    assets_dir, out_dir = argv[0], argv[1]
    work_dir = argv[2] if len(argv) > 2 else '/tmp/stage'
    only = set(argv[3:]) or None
    main(assets_dir, out_dir, work_dir, only)
