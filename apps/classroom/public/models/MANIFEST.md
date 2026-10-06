# The classroom's models

Eight files, 60 MB, not carried by Git for the same reason the courtroom's are
not — see `.gitignore` at the repository root. This manifest is how you know a
copy is complete.

| file | size | sha256 (first 16) |
|---|---:|---|
| `classroom_default.glb` | 3.7 MB | `7205c8e241a2c18d` |
| `classroom_alternative.glb` | 35.3 MB | `49def790a8faa947` |
| `Teacher_Nanami.glb` | 6.4 MB | `1977b01935a89f1f` |
| `Teacher_Naoki.glb` | 3.3 MB | `15fe92514675f0c1` |
| `animations_Nanami.glb` | 0.7 MB | `2c4cee89a0342f68` |
| `animations_Naoki.glb` | 0.6 MB | `b72e4af701a0ba3d` |
| `Nanami.fbx` | 7.3 MB | `ea08b30d20b9b176` |
| `Naoki.fbx` | 2.5 MB | `705595866c78006e` |

```bash
cd apps/classroom/public/models && sha256sum *.glb *.fbx | cut -c1-16
```

The two teachers are split into a mesh file and an animation file, which is why
there are four rather than two: the clips are loaded separately and retargeted
onto the skeleton. The `.fbx` pair are the sources those were exported from and
are not loaded at runtime — they are kept so the export can be redone.

`classroom_alternative.glb` is 35 MB, more than half of this directory, and is
the one worth attention if the language room ever needs to load faster — 23.5 MB
of it is texture and it carries 487,174 triangles, so both halves of the
courtroom's optimiser apply. It takes a directory:

```bash
node tools/optimise-assets.mjs --inventory --dir apps/classroom/public/models
```

which reports 50.0 MB of GLB here, 60% of it texture, projected to about
13.4 MB. Drop `--inventory` to run it for real; that needs the five encoder
packages listed in the root README.
