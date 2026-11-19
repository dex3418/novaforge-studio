# Shot library (v28)

`src/shots.js` holds 14 named shots: establishing, full, medium, two_shot, close_up, extreme_close_up, reaction,
over_shoulder, low_angle, high_angle, push_in, pull_out, pan_left, pan_right.

- The director (or the backup planner) writes only `"shot"` and `"on"` (a cast id) in a story beat. Old numeric cameras
  (`z0, z1, fx0, fx1`) still work when no shot is given.
- `frame()` turns the shot into zoom, horizontal focus, vertical focus (height on the figure: 0 feet, 1 top of head) and
  tilt at render time, from where the people stand and how tall they are, so a close-up lands on the face in portrait
  and landscape. Close shots hide the name tag.
- `nearestShot()` maps an invented name to a real one ("over the shoulder", "closeup_shot", "slow push in" ...);
  `cleanCamera()` also fixes an unknown cast id and a two-person shot on a one-person beat. Nothing invented reaches the renderer.
- `planShot()` is the grammar: open wide, ordinary dialogue medium / two_shot / over_shoulder, close_up on a strong feeling,
  extreme_close_up with shake for a shock then a reaction shot, high_angle for sad or worried, low_angle for proud,
  full for walking, never the same shot twice (also enforced on AI plans), no moves or extreme shots on beats under about 2 s.
- Framing numbers are tuned on the rigged Naina (big head, face at about 0.72 of the height). A learned character with other
  proportions may need its own face height: tell me and it goes into the registry.
- Test: `node tests/shots.test.js`.
