# Characters

Real artwork for story characters. A character listed here is drawn from its artwork, never redrawn
(its look in the script header, such as colours or hair, is ignored on purpose to keep identity locked).
Characters not listed here are still drawn by code, exactly as before.

```
characters/<id>/
  character.json     identity + what the character can do (angles, poses, fallbacks, rig)
  source/            the original SVG files. Never edited by any tool.
```

After changing anything here, rebuild and test (from `studio/`):

```
npm run characters   # cleans the art and bakes src/characters_data.js
npm test             # 16 checks, no extra packages
npm run sheet naina  # writes out/naina_sheet.svg/.png: every pose and angle, drawn by the real renderer
```

## character.json

- `angles`: each file, which way it faces (-1 left, 0 camera/away, 1 right) and optional cleaning
  (`remove_above_y`, `remove_left_x`) that deletes stray traced paths. Only whole paths are ever removed.
- `poses`: poses the character performs. `pose_fallback`: what an unsupported pose becomes (reported once, never silent).
- `pose_angle`: `front`, `three_quarter` or `profile` per pose; facing left/right picks the matching angle.
- `expressions`: expressions that exist in the artwork. Others fall back to the first one (reported).
- `rig.head_tilt`: angles where the head group may tilt (only angles that were checked visually).

To add a character: create `characters/<id>/`, add `character.json` and the SVGs, run `npm run characters`.
Required: a `front` angle and an `idle` pose. The build fails loudly if the rig groups or pivots are missing.
