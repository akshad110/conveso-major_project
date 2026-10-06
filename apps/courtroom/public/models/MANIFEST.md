# The courtroom's models

Ten files, 214 MB, and Git does not carry them — `CourtRoom.glb` is over
GitHub's 100 MB per-file limit on its own, so a repository containing it cannot
be pushed. They travel by zip instead. This manifest is how you know a copy is
complete.

Everything here is the user's own Meshy AI export. **Nothing in this directory
may be regenerated, re-posed or redesigned**, and `CourtRoom.glb` in particular
is never modified — the spawn coordinates in `src/config/courtroomLayout.js`
were measured from these exact files, and the clip names in
`src/config/animationMap.js` are read off them at runtime. Characters are fitted
to the room, not the reverse.

| file | size | sha256 (first 16) |
|---|---:|---|
| `CourtRoom.glb` | 100.6 MB | `2a39dc38a529cef5` |
| `clerk.glb` | 11.8 MB | `0bf3f01193ac71f7` |
| `defendant_female.glb` | 15.1 MB | `a59c366a67779bd5` |
| `defendant_male.glb` | 7.9 MB | `805937b4dbf39b82` |
| `defense.glb` | 7.8 MB | `7f2de94ea904a70c` |
| `judge.glb` | 26.5 MB | `757653c4e6f2835f` |
| `police.glb` | 26.4 MB | `c7f7ebd021fe3591` |
| `prosecutor.glb` | 7.8 MB | `38c1311508eaaaf2` |
| `witness_female.glb` | 1.5 MB | `4507666e2a5e09ea` |
| `witness_male.glb` | 8.1 MB | `a70731da09ad10f7` |

Check a copy from the repository root:

```bash
cd apps/courtroom/public/models && sha256sum *.glb | cut -c1-16
```

A missing file is not silent: `characterRegistry.js` names each one as a string
literal, so the loader throws for that character and the hearing runs without
them rather than rendering an empty room.

## Two notes on what is in here

`witness_female.glb` contains **0 materials, 0 textures and 0 images**, so three
falls back to a white `MeshStandardMaterial` and she renders grey. That is the
asset, not the renderer — a textured export is owed. Do not tint or invent
materials to cover it.

These are the **uncompressed** originals. `npm run assets` from the repository
root prints where the 214 MB actually goes (78% of it is texture; this room is
only 15,657 triangles), and `npm run assets:optimise` brings the set to roughly
31 MB using WebP and Meshopt — small enough that this directory could then be
committed outright. The optimiser rejects its own output if any clip name, joint
name or root transform moved, precisely because of the coupling described above.
