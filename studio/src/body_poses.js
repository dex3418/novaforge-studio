// Named poses for the code-drawn body (body_draw.js). Angles are in degrees and ADD to the rest pose
// (arms hang out a little). fb = forward/back, side = out (+) / in (-). root.y lifts or lowers the whole body.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NfBodyPoses = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const POSES = {
    standing: {},
    walking: { hip_l: { fb: 26 }, knee_l: { fb: 6 }, hip_r: { fb: -22 }, knee_r: { fb: 18 }, shoulder_l: { fb: -28 }, shoulder_r: { fb: 28 }, elbow_l: { fb: 10 }, elbow_r: { fb: 26 } },
    sitting: { root: { y: -54 }, hip_l: { fb: 90 }, hip_r: { fb: 90 }, knee_l: { fb: 90 }, knee_r: { fb: 90 }, shoulder_l: { fb: 25, side: -20 }, shoulder_r: { fb: 25, side: -20 }, elbow_l: { fb: 70 }, elbow_r: { fb: 70 } },
    pointing: { shoulder_r: { side: 40, fb: 55 }, elbow_r: { fb: 0 }, shoulder_l: { side: -14 } },
    waving: { shoulder_r: { side: 95 }, elbow_r: { fb: 15 }, wrist_r: { side: 18 }, shoulder_l: { side: -14 } },
    thinking: { shoulder_r: { fb: 50, side: -22 }, elbow_r: { fb: 125 }, shoulder_l: { fb: 30, side: -20 }, elbow_l: { fb: 95 }, neck: { fb: 10 } },
    celebrating: { root: { y: 22 }, shoulder_l: { side: 92 }, shoulder_r: { side: 92 }, elbow_l: { fb: 12 }, elbow_r: { fb: 12 }, hip_l: { fb: 22 }, hip_r: { fb: -8 }, knee_l: { fb: 45 }, knee_r: { fb: 60 } },
    worried: { shoulder_l: { fb: 35, side: -24 }, shoulder_r: { fb: 35, side: -24 }, elbow_l: { fb: 115 }, elbow_r: { fb: 115 }, neck: { fb: 12 }, waist: { fb: 6 } },
  };
  return { POSES };
}));
