type Live2DModelLike = {
  internalModel?: { coreModel?: any };
  _destroyed?: boolean;
};

type EmotionConfig = {
  mouthForm: number;
  mouthOpen: number;
  cheek: number;
  eyeSmile: number;
  eyeOpen: number;
  browY: number;
  pupilScale?: number;
  angleX?: number;
  angleY?: number;
  angleZ?: number;
  lowerLid?: number;
  mouthSmileLower?: number;
};

const setIfExists = (coreModel: any, id: string, value: number) => {
  if (!coreModel?.setParameterValueById) return;
  try {
    coreModel.setParameterValueById(id, value);
  } catch (err) {
    // ignore missing params
  }
};

const setFirstAvailable = (coreModel: any, ids: string[], value: number) => {
  ids.forEach((id) => setIfExists(coreModel, id, value));
};

const applyEmotion = (model: Live2DModelLike, cfg: EmotionConfig) => {
  if (!model || model._destroyed) return;
  const core = model.internalModel?.coreModel;
  if (!core) return;

  setFirstAvailable(
    core,
    ["ParamMouthForm", "ParamMouthSmile", "ParamMouthFormSmile", "ParamMouthWidth"],
    cfg.mouthForm
  );
  setFirstAvailable(core, ["ParamMouthOpenY", "ParamMouthOpen", "ParamMouthOpenSmile"], cfg.mouthOpen);
  if (cfg.mouthSmileLower !== undefined) {
    setFirstAvailable(core, ["ParamMouthForm2", "ParamMouthSmileLower", "ParamMouthLower"], cfg.mouthSmileLower);
  }
  setFirstAvailable(core, ["ParamCheek", "ParamFlush", "ParamCheekSmile"], cfg.cheek);

  setFirstAvailable(core, ["ParamEyeLSmile", "ParamEyeLForm", "ParamEyeLSmileLine"], cfg.eyeSmile);
  setFirstAvailable(core, ["ParamEyeRSmile", "ParamEyeRForm", "ParamEyeRSmileLine"], cfg.eyeSmile);
  setFirstAvailable(core, ["ParamEyeLOpen", "ParamEyeLFormEyeOpen"], cfg.eyeOpen);
  setFirstAvailable(core, ["ParamEyeROpen", "ParamEyeRFormEyeOpen"], cfg.eyeOpen);
  if (cfg.lowerLid !== undefined) {
    setFirstAvailable(core, ["ParamEyeLLower", "ParamEyeLowerLidL", "ParamEyeLSmile2"], cfg.lowerLid);
    setFirstAvailable(core, ["ParamEyeRLower", "ParamEyeLowerLidR", "ParamEyeRSmile2"], cfg.lowerLid);
  }

  setFirstAvailable(core, ["ParamBrowLY", "ParamBrowLForm", "ParamBrowY", "ParamBrowLPosY"], cfg.browY);
  setFirstAvailable(core, ["ParamBrowRY", "ParamBrowRForm", "ParamBrowY", "ParamBrowRPosY"], cfg.browY);
  if (cfg.pupilScale !== undefined) {
    setIfExists(core, "ParamEyeBallScaleX", cfg.pupilScale);
    setIfExists(core, "ParamEyeBallScaleY", cfg.pupilScale);
  }
  if (cfg.angleX !== undefined) {
    setIfExists(core, "ParamAngleX", cfg.angleX);
  }
  if (cfg.angleY !== undefined) {
    setIfExists(core, "ParamAngleY", cfg.angleY);
  }
  if (cfg.angleZ !== undefined) {
    setIfExists(core, "ParamAngleZ", cfg.angleZ);
  }
};

/**
 * Neutral emotion: relaxed mouth, neutral cheeks/eyes/brows.
 */
export const setNeutralEmotion = (model: Live2DModelLike) => {
  if (happyRaf) {
    cancelAnimationFrame(happyRaf);
    happyRaf = null;
  }
  happyHeld = false; // reset happy hold when switching out
  sadHeld = false;
  if (sadRaf) {
    cancelAnimationFrame(sadRaf);
    sadRaf = null;
  }
  applyEmotion(model, {
    mouthForm: 0,
    mouthOpen: 0.05,
    cheek: 0,
    eyeSmile: 0,
    eyeOpen: 1,
    browY: 0,
    pupilScale: 1,
    angleZ: 0
  });
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
let happyRaf: number | null = null;
let happyHeld = false;
let sadRaf: number | null = null;
let sadHeld = false;

const readParam = (coreModel: any, ids: string[], fallback: number) => {
  for (const id of ids) {
    try {
      const v = coreModel?.getParameterValueById?.(id);
      if (typeof v === "number") return v;
    } catch {
      // ignore missing getters
    }
  }
  return fallback;
};

const readCurrentPose = (coreModel: any): EmotionConfig => ({
  mouthForm: readParam(coreModel, ["ParamMouthForm", "ParamMouthSmile", "ParamMouthFormSmile", "ParamMouthWidth"], 0),
  mouthOpen: readParam(coreModel, ["ParamMouthOpenY", "ParamMouthOpen", "ParamMouthOpenSmile"], 0.05),
  mouthSmileLower: readParam(coreModel, ["ParamMouthForm2", "ParamMouthSmileLower", "ParamMouthLower"], 0),
  cheek: readParam(coreModel, ["ParamCheek", "ParamFlush", "ParamCheekSmile"], 0),
  eyeSmile: readParam(coreModel, ["ParamEyeLSmile", "ParamEyeLForm", "ParamEyeLSmileLine"], 0),
  eyeOpen: readParam(coreModel, ["ParamEyeLOpen", "ParamEyeLFormEyeOpen"], 1),
  browY: readParam(coreModel, ["ParamBrowLY", "ParamBrowLForm", "ParamBrowY", "ParamBrowLPosY"], 0),
  pupilScale: readParam(coreModel, ["ParamEyeBallScaleX", "ParamEyeBallScaleY"], 1),
  angleX: readParam(coreModel, ["ParamAngleX"], 0),
  angleY: readParam(coreModel, ["ParamAngleY"], 0),
  angleZ: readParam(coreModel, ["ParamAngleZ"], 0),
  lowerLid: readParam(coreModel, ["ParamEyeLLower", "ParamEyeLowerLidL", "ParamEyeLSmile2"], 0)
});

const mixPose = (from: EmotionConfig, to: EmotionConfig, t: number): EmotionConfig => ({
  mouthForm: lerp(from.mouthForm, to.mouthForm, t),
  mouthOpen: lerp(from.mouthOpen, to.mouthOpen, t),
  mouthSmileLower: lerp(from.mouthSmileLower ?? 0, to.mouthSmileLower ?? 0, t),
  cheek: lerp(from.cheek, to.cheek, t),
  eyeSmile: lerp(from.eyeSmile, to.eyeSmile, t),
  eyeOpen: lerp(from.eyeOpen, to.eyeOpen, t),
  browY: lerp(from.browY, to.browY, t),
  pupilScale: lerp(from.pupilScale ?? 1, to.pupilScale ?? 1, t),
  angleX: lerp(from.angleX ?? 0, to.angleX ?? 0, t),
  angleY: lerp(from.angleY ?? 0, to.angleY ?? 0, t),
  angleZ: lerp(from.angleZ ?? 0, to.angleZ ?? 0, t),
  lowerLid: lerp(from.lowerLid ?? 0, to.lowerLid ?? 0, t)
});

const applyHappyFrame = (model: Live2DModelLike, t: number) => {
  // t: 0..1 (0.6s total), slower warm-up from other emotions
  const duration1 = 0.30;
  const duration2 = 0.64;
  const duration3 = 0.90;
  const duration4 = 1.20;

  let mouthForm = 0;
  let mouthOpen = 0.03;
  let mouthSmileLower = 0;
  let cheek = 0;
  let eyeSmile = 0;
  let eyeOpen = 1;
  let browY = 0;
  let pupilScale = 1;
  let angleZ = 0;
  let lowerLid = 0;

  if (t <= duration1) {
    const p = clamp01(t / duration1);
    eyeSmile = lerp(0, 0.35, p);
    lowerLid = lerp(0, 0.12, p); // mí dưới cong nhẹ
    eyeOpen = lerp(1, 0.95, p);
    pupilScale = lerp(1, 0.97, p);
    browY = lerp(0, 0.1, p); // chân mày hơi nâng
    cheek = lerp(0, 0.18, p);
    mouthForm = lerp(0, 0.05, p);
    mouthSmileLower = mouthForm;
    angleZ = lerp(0, 1.5, p); // slight head tilt
  } else if (t <= duration2) {
    const p = clamp01((t - duration1) / (duration2 - duration1));
    eyeSmile = lerp(0.35, 0.8, p);
    lowerLid = lerp(0.12, 0.25, p);
    eyeOpen = lerp(0.95, 0.85, p);
    pupilScale = lerp(0.97, 0.95, p);
    browY = lerp(0.1, 0.22, p);
    cheek = lerp(0.18, 0.8, p);
    mouthForm = lerp(0.05, 0.9, p); // spread then curve
    mouthSmileLower = mouthForm;
    mouthOpen = lerp(0.04, 0.07, p); // giữ miệng kín, hé nhẹ
    angleZ = lerp(1.5, 2.5, p);
  } else if (t <= duration3) {
    const p = clamp01((t - duration2) / (duration3 - duration2));
    const ease = 1 - p * 0.5; // overbounce soften
    eyeSmile = lerp(0.8, 0.7, p);
    lowerLid = lerp(0.25, 0.2, p);
    eyeOpen = lerp(0.85, 0.7, p); // micro blink
    pupilScale = lerp(0.95, 0.92, p);
    browY = lerp(0.22, 0.2, p);
    cheek = lerp(0.8, 0.72, p);
    mouthForm = lerp(0.9, 0.82, p) * ease;
    mouthSmileLower = mouthForm;
    mouthOpen = lerp(0.07, 0.06, p); // vẫn kín
    angleZ = lerp(2.5, 3.5, p); // tilt a bit more before spring back
  } else {
    const p = clamp01((t - duration3) / (duration4 - duration3));
    const settle = 1 + 0.05 * Math.sin(p * Math.PI); // soft spring feel
    eyeSmile = lerp(0.7, 0.65, p);
    lowerLid = lerp(0.2, 0.18, p);
    eyeOpen = lerp(0.7, 0.85, p);
    pupilScale = lerp(0.92, 0.98, p);
    browY = lerp(0.2, 0.18, p);
    cheek = lerp(0.72, 0.7, p);
    mouthForm = lerp(0.82, 0.7, p) * settle; // keep 60-70% curve
    mouthSmileLower = mouthForm;
    mouthOpen = lerp(0.06, 0.05, p); // giữ miệng đóng
    angleZ = lerp(3.5, 1.8, p);
  }

  applyEmotion(model, {
    mouthForm,
    mouthOpen,
    cheek,
    eyeSmile,
    eyeOpen,
    browY,
    pupilScale,
    angleZ,
    lowerLid,
    mouthSmileLower
  });
};

/**
 * Happy emotion animation (0.45s) with natural timing: eyes react first, smile blooms then settles with a soft spring.
 */
export const playHappyEmotion = (model: Live2DModelLike) => {
  if (!model || model._destroyed) return;
  if (!happyRaf && happyHeld) return; // already in happy pose, keep it
  if (sadRaf) {
    cancelAnimationFrame(sadRaf);
    sadRaf = null;
  }
  sadHeld = false;
  if (!model.internalModel?.coreModel) {
    happyHeld = false;
    return; // model chưa sẵn sàng
  }
  if (happyRaf) cancelAnimationFrame(happyRaf);

  const start = performance.now();
  const duration = 1200;
  happyHeld = false; // will set true after first applied frame

  const tick = () => {
    if (!model || (model as any)._destroyed) {
      happyHeld = false;
      return;
    }
    if (!model.internalModel?.coreModel) {
      happyHeld = false;
      happyRaf = null;
      return;
    }
    const now = performance.now();
    const t = Math.min((now - start) / duration, 1);
    applyHappyFrame(model, t);
    happyHeld = true;
    if (t < 1) {
      happyRaf = requestAnimationFrame(tick);
    } else {
      happyRaf = null;
    }
  };

  requestAnimationFrame(tick);
};

const getSadTarget = (timeSec: number): EmotionConfig => {
  const duration1 = 0.3;
  const duration2 = 0.6;
  const duration3 = 0.9;
  const duration4 = 1.1;

  let mouthForm = -0.08;
  let mouthOpen = 0.03;
  let mouthSmileLower = 0.04;
  let cheek = -0.05;
  let eyeSmile = -0.03;
  let eyeOpen = 1;
  let browY = 0;
  let pupilScale = 0.99;
  let angleZ = 0;
  let angleY = 0;
  let lowerLid = 0;

  if (timeSec <= duration1) {
    const p = clamp01(timeSec / duration1);
    eyeOpen = lerp(1, 0.9, p);
    lowerLid = lerp(0, -0.08, p);
    browY = lerp(0, 0.08, p);
    angleY = lerp(0, -1.2, p);
    angleZ = lerp(0, -0.6, p);
  } else if (timeSec <= duration2) {
    const p = clamp01((timeSec - duration1) / (duration2 - duration1));
    eyeOpen = lerp(0.9, 0.76, p);
    lowerLid = lerp(-0.08, -0.16, p);
    eyeSmile = lerp(-0.03, -0.1, p);
    browY = lerp(0.08, 0.18, p);
    mouthForm = lerp(-0.08, -0.26, p);
    mouthSmileLower = lerp(0.04, 0.14, p);
    mouthOpen = lerp(0.03, 0.05, p);
    cheek = lerp(-0.05, -0.08, p);
    pupilScale = lerp(0.99, 0.96, p);
    angleY = lerp(-1.2, -3.2, p);
    angleZ = lerp(-0.6, -2, p);
  } else if (timeSec <= duration3) {
    const p = clamp01((timeSec - duration2) / (duration3 - duration2));
    eyeOpen = lerp(0.76, 0.64, p);
    lowerLid = lerp(-0.16, -0.22, p);
    eyeSmile = lerp(-0.1, -0.16, p);
    browY = lerp(0.18, 0.26, p);
    mouthForm = lerp(-0.26, -0.38, p);
    mouthSmileLower = lerp(0.14, 0.22, p);
    mouthOpen = lerp(0.05, 0.07, p);
    cheek = lerp(-0.08, -0.12, p);
    pupilScale = lerp(0.96, 0.94, p);
    angleY = lerp(-3.2, -6.5, p);
    angleZ = lerp(-2, -3.5, p);
  } else {
    const p = clamp01((timeSec - duration3) / (duration4 - duration3));
    const baseEyeOpen = 0.64;
    const baseLowerLid = -0.22;
    const baseMouthForm = -0.38;
    const baseMouthOpen = 0.07;
    const baseMouthSmileLower = 0.22;
    const baseCheek = -0.12;
    const baseEyeSmile = -0.16;
    const basePupilScale = 0.94;
    const baseAngleY = -6.5;
    const baseAngleZ = -3.5;
    const blinkStart = 0.1;
    const blinkSpan = 0.2;

    eyeOpen = baseEyeOpen;
    lowerLid = baseLowerLid;
    mouthForm = baseMouthForm;
    mouthSmileLower = baseMouthSmileLower;
    mouthOpen = baseMouthOpen;
    cheek = baseCheek;
    eyeSmile = baseEyeSmile;
    pupilScale = basePupilScale;
    angleY = baseAngleY;
    angleZ = baseAngleZ;

    // Soft blink + droop micro motion
    if (p > blinkStart && p < blinkStart + blinkSpan) {
      const blinkP = clamp01((p - blinkStart) / blinkSpan);
      const curve = Math.sin(blinkP * Math.PI);
      eyeOpen = lerp(baseEyeOpen, 0.42, curve);
      lowerLid = lerp(baseLowerLid, -0.24, curve);
    }

    // head sinks then nudges back slightly
    const drop = -1.4 * Math.sin(Math.min(p, 0.6) / 0.6 * (Math.PI / 2));
    const rebound = p > 0.6 ? 0.6 * ((p - 0.6) / 0.4) : 0;
    angleY = baseAngleY + drop + rebound;
    angleZ = baseAngleZ + Math.sin(p * Math.PI) * -0.45;

    // subtle lip tremble and breath
    mouthForm = baseMouthForm + Math.sin(p * Math.PI * 3) * 0.018;
    mouthOpen = baseMouthOpen + Math.sin(p * Math.PI * 4 + 0.6) * 0.012;
    mouthSmileLower = baseMouthSmileLower + Math.sin(p * Math.PI * 2) * 0.024;
  }

  return {
    mouthForm,
    mouthOpen,
    cheek,
    eyeSmile,
    eyeOpen,
    browY,
    pupilScale,
    angleY,
    angleZ,
    lowerLid,
    mouthSmileLower
  };
};

/**
 * Sad emotion animation (~1.1s) with eyes leading, brows following, and a gentle weighted head drop.
 */
export const playSadEmotion = (model: Live2DModelLike) => {
  if (!model || model._destroyed) return;
  if (sadRaf || sadHeld) return; // giữ nguyên nếu đang/đã buồn
  if (!model.internalModel?.coreModel) return;
  if (happyRaf) {
    cancelAnimationFrame(happyRaf);
    happyRaf = null;
  }
  happyHeld = false;
  if (sadRaf) {
    cancelAnimationFrame(sadRaf);
    sadRaf = null;
  }

  const start = performance.now();
  const durationMs = 1100;
  const totalSec = durationMs / 1000;
  const core = model.internalModel.coreModel;
  const startPose = readCurrentPose(core);

  const tick = () => {
    if (!model || (model as any)._destroyed) {
      sadRaf = null;
      sadHeld = false;
      return;
    }
    if (!model.internalModel?.coreModel) {
      sadRaf = null;
      sadHeld = false;
      return;
    }

    const elapsedSec = Math.min((performance.now() - start) / 1000, totalSec);
    const t = clamp01(elapsedSec / totalSec);
    const target = getSadTarget(elapsedSec);
    const mix = 1 - Math.pow(1 - t, 2); // ease-out để blend mượt hơn từ trạng thái hiện tại
    const blended = mixPose(startPose, target, mix);
    applyEmotion(model, blended);

    if (elapsedSec < totalSec) {
      sadRaf = requestAnimationFrame(tick);
    } else {
      sadRaf = null;
      sadHeld = true;
    }
  };

  requestAnimationFrame(tick);
};
