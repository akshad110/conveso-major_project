"""Minimal dependency-free glTF/GLB reader + writer utilities."""
import json, struct, math, os

COMP = {5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
NUM  = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT2':4,'MAT3':9,'MAT4':16}

def load_glb(path):
    with open(path,'rb') as f:
        raw = f.read()
    magic, ver, length = struct.unpack_from('<4sII', raw, 0)
    assert magic == b'glTF'
    off = 12; js=None; bin_=b''
    while off < length:
        clen, ctype = struct.unpack_from('<I4s', raw, off); off += 8
        chunk = raw[off:off+clen]; off += clen
        if ctype == b'JSON': js = json.loads(chunk.decode('utf-8'))
        elif ctype[:3] == b'BIN': bin_ = chunk
    return js, bytearray(bin_)

def save_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',',':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bytes(bin_) + b'\x00' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    out = bytearray()
    out += struct.pack('<4sII', b'glTF', 2, total)
    out += struct.pack('<I4s', len(jb), b'JSON') + jb
    if bb: out += struct.pack('<I4s', len(bb), b'BIN\x00') + bb
    with open(path,'wb') as f: f.write(out)

def read_accessor(js, bin_, idx):
    a = js['accessors'][idx]
    n = NUM[a['type']]; fmt, sz = COMP[a['componentType']]
    count = a['count']
    if 'bufferView' not in a: return [[0.0]*n for _ in range(count)]
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset',0) + a.get('byteOffset',0)
    stride = bv.get('byteStride') or n*sz
    out = []
    for i in range(count):
        o = base + i*stride
        out.append(list(struct.unpack_from('<'+fmt*n, bin_, o)))
    return out

def accessor_bytes(js, bin_, idx):
    """Raw tightly-packed bytes for an accessor (handles interleaving)."""
    a = js['accessors'][idx]
    n = NUM[a['type']]; fmt, sz = COMP[a['componentType']]
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset',0) + a.get('byteOffset',0)
    stride = bv.get('byteStride') or n*sz
    if stride == n*sz:
        return bytes(bin_[base: base + a['count']*n*sz])
    out = bytearray()
    for i in range(a['count']):
        o = base + i*stride
        out += bin_[o:o+n*sz]
    return bytes(out)

# ---- math -------------------------------------------------------------
def q_mul(a, b):
    ax,ay,az,aw = a; bx,by,bz,bw = b
    return [aw*bx+ax*bw+ay*bz-az*by,
            aw*by-ax*bz+ay*bw+az*bx,
            aw*bz+ax*by-ay*bx+az*bw,
            aw*bw-ax*bx-ay*by-az*bz]

def q_to_m(q):
    x,y,z,w = q
    return [[1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w)],
            [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w)],
            [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y)]]

def trs_to_m4(t, r, s):
    m = q_to_m(r)
    return [[m[0][0]*s[0], m[0][1]*s[1], m[0][2]*s[2], t[0]],
            [m[1][0]*s[0], m[1][1]*s[1], m[1][2]*s[2], t[1]],
            [m[2][0]*s[0], m[2][1]*s[1], m[2][2]*s[2], t[2]],
            [0,0,0,1]]

def m4_mul(a,b):
    return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def m4_pos(m): return [m[0][3], m[1][3], m[2][3]]

def m4_from_node(n):
    if 'matrix' in n:
        mm = n['matrix']
        return [[mm[0],mm[4],mm[8],mm[12]],[mm[1],mm[5],mm[9],mm[13]],
                [mm[2],mm[6],mm[10],mm[14]],[mm[3],mm[7],mm[11],mm[15]]]
    return trs_to_m4(n.get('translation',[0,0,0]), n.get('rotation',[0,0,0,1]), n.get('scale',[1,1,1]))

def slerp(a, b, t):
    d = sum(a[i]*b[i] for i in range(4))
    if d < 0: b = [-v for v in b]; d = -d
    if d > 0.9995:
        r = [a[i]+t*(b[i]-a[i]) for i in range(4)]
    else:
        th0 = math.acos(max(-1,min(1,d))); th = th0*t
        s0 = math.sin(th0); s1 = math.sin(th0-th)/s0; s2 = math.sin(th)/s0
        r = [a[i]*s1 + b[i]*s2 for i in range(4)]
    l = math.sqrt(sum(v*v for v in r)) or 1
    return [v/l for v in r]

def lerp3(a,b,t): return [a[i]+(b[i]-a[i])*t for i in range(len(a))]
