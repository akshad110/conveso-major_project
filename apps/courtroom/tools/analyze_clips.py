"""Sample every animation clip in a GLB, run forward kinematics on the skeleton,
and derive motion features so clips can be classified without knowing their names."""
import sys, os, glob, json, math, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_lib import *

def build_clip(js, bin_, ai):
    anim = js['animations'][ai]
    tracks = {}   # node -> {path: (times, values, interp)}
    for ch in anim['channels']:
        tgt = ch.get('target', {})
        if 'node' not in tgt: continue
        s = anim['samplers'][ch['sampler']]
        times = [t[0] for t in read_accessor(js, bin_, s['input'])]
        vals  = read_accessor(js, bin_, s['output'])
        tracks.setdefault(tgt['node'], {})[tgt['path']] = (times, vals, s.get('interpolation','LINEAR'))
    dur = max((t[-1] for nd in tracks.values() for (t,_,_) in nd.values() if t), default=0)
    return tracks, dur

def sample(track, t):
    times, vals, interp = track
    if not times: return None
    if t <= times[0]: return vals[0]
    if t >= times[-1]: return vals[-1]
    i = bisect.bisect_right(times, t) - 1
    t0, t1 = times[i], times[i+1]
    f = 0 if t1 == t0 else (t - t0) / (t1 - t0)
    if interp == 'STEP': return vals[i]
    return vals[i], vals[i+1], f

def resolve(track, t, path):
    r = sample(track, t)
    if r is None: return None
    if not isinstance(r, tuple): return r
    a, b, f = r
    return slerp(a, b, f) if path == 'rotation' else lerp3(a, b, f)

def fk(js, tracks, t):
    nodes = js['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    world = {}
    def local(i):
        n = nodes[i]
        tr = tracks.get(i, {})
        T = resolve(tr['translation'], t, 'translation') if 'translation' in tr else n.get('translation',[0,0,0])
        R = resolve(tr['rotation'], t, 'rotation') if 'rotation' in tr else n.get('rotation',[0,0,0,1])
        S = resolve(tr['scale'], t, 'scale') if 'scale' in tr else n.get('scale',[1,1,1])
        return trs_to_m4(T, R, S)
    def solve(i):
        if i in world: return world[i]
        m = local(i)
        p = parent.get(i)
        world[i] = m4_mul(solve(p), m) if p is not None else m
        return world[i]
    for i in range(len(nodes)): solve(i)
    return world

def features(path, clip_index, samples=24):
    js, bin_ = load_glb(path)
    nodes = js['nodes']
    byname = {n.get('name'): i for i, n in enumerate(nodes)}
    tracks, dur = build_clip(js, bin_, clip_index)
    if dur <= 0: return None
    ts = [dur * i / (samples - 1) for i in range(samples)]
    frames = [fk(js, tracks, t) for t in ts]
    def wp(fr, name):
        # Check for the name as-is, or with the common Meshy/Mixamo prefix
        cand = [name, f'mixamorig:{name}']
        for c in cand:
            if c in byname: return m4_pos(fr[byname[c]])
        return None
    hips  = [wp(f,'Hips') for f in frames]
    head  = [wp(f,'Head') for f in frames]
    lh    = [wp(f,'LeftHand') for f in frames]
    rh    = [wp(f,'RightHand') for f in frames]
    lf    = [wp(f,'LeftFoot') for f in frames]
    rf    = [wp(f,'RightFoot') for f in frames]
    sh    = [wp(f,'Spine') for f in frames]
    hf    = [wp(f,'headfront') for f in frames]
    he    = [wp(f,'head_end') for f in frames]
    # up axis = axis with largest head-vs-foot separation
    sep = [abs(head[0][k] - ((lf[0][k]+rf[0][k])/2)) for k in range(3)]
    up = sep.index(max(sep))
    ground = min(min(p[up] for p in lf), min(p[up] for p in rf))
    def h(p): return p[up] - ground
    horiz = [k for k in range(3) if k != up]
    def dist2(a, b): return math.hypot(a[horiz[0]]-b[horiz[0]], a[horiz[1]]-b[horiz[1]])
    hip_h = [h(p) for p in hips]
    head_h = [h(p) for p in head]
    travel = sum(dist2(hips[i], hips[i+1]) for i in range(len(hips)-1))
    net    = dist2(hips[0], hips[-1])
    foot_lift = max(h(p) for p in lf + rf)
    # hand activity: path length of each hand relative to hips (removes root motion)
    def rel(p, q): return [p[k]-q[k] for k in range(3)]
    def plen(seq, ref):
        r = [rel(seq[i], ref[i]) for i in range(len(seq))]
        return sum(math.dist(r[i], r[i+1]) for i in range(len(r)-1))
    lh_act = plen(lh, hips); rh_act = plen(rh, hips)
    # hand height relative to shoulder line
    rh_rise = max(h(rh[i]) - h(sh[i]) for i in range(len(rh)))
    lh_rise = max(h(lh[i]) - h(sh[i]) for i in range(len(lh)))
    # head gaze vector -> yaw / pitch swing
    yaw = []; pitch = []
    for i in range(len(frames)):
        if hf[i] is None or he[i] is None: break
        v = rel(hf[i], head[i])
        yaw.append(math.degrees(math.atan2(v[horiz[0]], v[horiz[1]])))
        n = math.dist(hf[i], head[i]) or 1
        pitch.append(math.degrees(math.asin(max(-1,min(1, v[up]/n)))))
    def swing(a):
        if not a: return 0
        return round(max(a)-min(a), 1)
    # zero crossings of yaw about its mean -> head shake count
    def crossings(a):
        if not a: return 0
        m = sum(a)/len(a); c = 0
        for i in range(len(a)-1):
            if (a[i]-m) * (a[i+1]-m) < 0: c += 1
        return c
    body_energy = sum(math.dist(rel(head[i],hips[i]), rel(head[i+1],hips[i+1])) for i in range(len(head)-1))
    return dict(
        duration=round(dur,2),
        hip_h=round(sum(hip_h)/len(hip_h),1), hip_h_min=round(min(hip_h),1), hip_h_max=round(max(hip_h),1),
        head_h=round(sum(head_h)/len(head_h),1),
        travel=round(travel,1), net=round(net,1), foot_lift=round(foot_lift,1),
        lh_act=round(lh_act,1), rh_act=round(rh_act,1),
        rh_rise=round(rh_rise,1), lh_rise=round(lh_rise,1),
        yaw_swing=swing(yaw), pitch_swing=swing(pitch),
        yaw_cross=crossings(yaw), pitch_cross=crossings(pitch),
        body_energy=round(body_energy,1),
    )

if __name__ == '__main__':
    root = sys.argv[1]
    rows = []
    for f in sorted(glob.glob(os.path.join(root, '**', '*.glb'), recursive=True)):
        js, _ = load_glb(f)
        for ai, a in enumerate(js.get('animations', [])):
            ft = features(f, ai)
            if ft is None or ft['duration'] < 0.5: continue
            rows.append(dict(char=os.path.relpath(f, root).split(os.sep)[0],
                             clip=a.get('name'), file=os.path.basename(f), **ft))
    print(json.dumps(rows, indent=0))
