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
npm test             # 18 checks, no extra packages
npm run sheet naina  # writes out/naina_sheet.svg/.png: every pose and angle, drawn by the real renderer
```

## character.json

- `angles`: each file, which way it faces (-1 left, 0 camera/away, 1 right) and optional cleaning
  (`remove_above_y`, `remove_left_x`) that deletes stray traced paths. Only whole paths are ever removed.
- `poses`: poses the character performs. `pose_fallback`: what an unsupported pose becomes (reported once, never silent).
- `pose_angle`: `front`, `three_quarter` or `profile` per pose; facing left/right picks the matching angle.
- `expressions`: expressions that exist in the artwork. Others fall back to the first one (reported).
- `backing`: width (0 to 12, default 6) of a colour-matched layer drawn under the art. Traced art has hairline gaps
  that let the scene show through; the backing closes them. 0 turns it off.
- `rig.head_tilt`: angles where the head group may tilt (only angles that were checked visually).

To add a character: create `characters/<id>/`, add `character.json` and the SVGs, run `npm run characters`.
Required: a `front` angle and an `idle` pose. The build fails loudly if the rig groups or pivots are missing.

## Whole-pose drawings (`variants`, from v18)

`characters/<id>/library/` holds complete flat drawings (walking frames, action poses, expression close-ups). They are
declared in `character.json` under `variants`:

```json
"variants": { "walk": { "front": {"file": "library/walking_poses/naina_walk_01_front.svg", "faces": 0}, "...": {} },
              "wave": { "any":   {"file": "library/action_poses/naina_pose_09_relieved_wave.svg", "faces": 0} } }
```

- Keys are camera angles (like `front_left_45`) or `any` when a pose has one drawing. `faces` is the way the drawing looks (-1 left, 1 right, 0 front); a drawing that faces the wrong way is mirrored around its feet.
- `stand_h` (optional) says how tall a standing figure would be in that drawing's units, so head size matches everywhere. Drawings that are only head-and-shoulders (stand_h well above their own height) hang from the head-top line and fade out at the bottom.
- The build removes tracing leftovers (a flat label bar at the top, thin slivers at a side edge) as whole shapes. Files in `library/` are never edited.
- Poses with a drawing and no rig get whole-body motion only (bob, lean, hop), no head tilt and no talking mouth.
- Changing pose (e.g. walk -> idle after arriving) blends for 0.3 s: old drawing stays opaque, the new one fades in with a small hop.

## Derived characters (`extends`, from v21)

`characters/nikita/character.json` shows the idea: `"extends": "naina"` plus `recolor` rules. The renderer draws Naina's
drawings with the colours of one hue family moved to a new hue (here the blue kurta to magenta). Nothing is copied, so a
derived character costs a few lines of JSON, and poses added to Naina later appear on Nikita automatically.

```json
{ "character_id": "nikita", "name": "Nikita", "extends": "naina",
  "recolor": [ { "from_hue": [190, 260], "min_sat": 0.2, "to_hue": 340, "keep_spread": 0.4 } ] }
```

Rule fields: `from_hue [a,b]` colours to move (0-360), `to_hue` where they go, `min_sat` leave greys alone, `keep_spread`
how much of the original hue variation to keep, `light_mult` / `sat_mult` to lighten, darken or mute.

What recolouring can and cannot do: clothes, skin tone and similar colour families, yes. A different hairstyle, eye shape or
face needs new drawings, because the shapes themselves change. Naina's hair and outlines share the same dark colours, so hair
colour cannot be changed separately yet.
