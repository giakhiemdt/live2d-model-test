export type EmotionPose = {
  mouthForm?: number;
  mouthOpen?: number;
  mouthSmileLower?: number;
  mouthX?: number;
  cheek?: number;
  cheekPuff?: number;
  eyeSmile?: number;
  eyeOpen?: number;
  browY?: number;
  browX?: number;
  pupilScale?: number;
  angleX?: number;
  angleY?: number;
  angleZ?: number;
  lowerLid?: number;
  tongueOut?: number;
  jawOpen?: number;
  mouthShrug?: number;
  mouthPucker?: number;
  eyeBallX?: number;
  eyeBallY?: number;
  eyeExpression1?: number;
  eyeExpression2?: number;
};

export type EmotionKeyframe = {
  durationMs: number;
  params: EmotionPose;
};

export type EmotionDefinition = {
  id: string;
  label: string;
  keyframes: EmotionKeyframe[];
};

type Live2DModelLike = {
  internalModel?: { coreModel?: any };
  _destroyed?: boolean;
};

const setIfExists = (coreModel: any, id: string, value: number) => {
  if (!coreModel?.setParameterValueById) return;
  try {
    coreModel.setParameterValueById(id, value);
  } catch {
    // ignore missing params
  }
};

const setFirstAvailable = (coreModel: any, ids: string[], value: number) => {
  ids.forEach((id) => setIfExists(coreModel, id, value));
};

const applyPose = (model: Live2DModelLike, pose: EmotionPose) => {
  if (!model || model._destroyed) return;
  const core = model.internalModel?.coreModel;
  if (!core) return;

  const cfg = pose;

  if (cfg.mouthForm !== undefined) {
    setFirstAvailable(
      core,
      ["ParamMouthForm", "ParamMouthSmile", "ParamMouthFormSmile", "ParamMouthWidth"],
      cfg.mouthForm
    );
  }
  if (cfg.mouthOpen !== undefined) {
    setFirstAvailable(core, ["ParamMouthOpenY", "ParamMouthOpen", "ParamMouthOpenSmile"], cfg.mouthOpen);
  }
  if (cfg.mouthSmileLower !== undefined) {
    setFirstAvailable(core, ["ParamMouthForm2", "ParamMouthSmileLower", "ParamMouthLower"], cfg.mouthSmileLower);
  }
  if (cfg.mouthX !== undefined) {
    setIfExists(core, "ParamMouthX", cfg.mouthX);
  }
  if (cfg.cheek !== undefined) {
    setFirstAvailable(core, ["ParamCheek", "ParamFlush", "ParamCheekSmile"], cfg.cheek);
  }
  if (cfg.cheekPuff !== undefined) {
    setIfExists(core, "ParamCheekPuff", cfg.cheekPuff);
  }

  if (cfg.eyeSmile !== undefined) {
    setFirstAvailable(core, ["ParamEyeLSmile", "ParamEyeLForm", "ParamEyeLSmileLine"], cfg.eyeSmile);
    setFirstAvailable(core, ["ParamEyeRSmile", "ParamEyeRForm", "ParamEyeRSmileLine"], cfg.eyeSmile);
  }
  if (cfg.eyeOpen !== undefined) {
    setFirstAvailable(core, ["ParamEyeLOpen", "ParamEyeLFormEyeOpen"], cfg.eyeOpen);
    setFirstAvailable(core, ["ParamEyeROpen", "ParamEyeRFormEyeOpen"], cfg.eyeOpen);
  }
  if (cfg.lowerLid !== undefined) {
    setFirstAvailable(core, ["ParamEyeLLower", "ParamEyeLowerLidL", "ParamEyeLSmile2"], cfg.lowerLid);
    setFirstAvailable(core, ["ParamEyeRLower", "ParamEyeLowerLidR", "ParamEyeRSmile2"], cfg.lowerLid);
  }

  if (cfg.browY !== undefined) {
    setFirstAvailable(core, ["ParamBrowLY", "ParamBrowLForm", "ParamBrowY", "ParamBrowLPosY"], cfg.browY);
    setFirstAvailable(core, ["ParamBrowRY", "ParamBrowRForm", "ParamBrowY", "ParamBrowRPosY"], cfg.browY);
  }
  if (cfg.browX !== undefined) {
    setIfExists(core, "ParamEyeBrowX", cfg.browX);
  }

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
  if (cfg.eyeBallX !== undefined) {
    setIfExists(core, "ParamEyeBallX", cfg.eyeBallX);
  }
  if (cfg.eyeBallY !== undefined) {
    setIfExists(core, "ParamEyeBallY", cfg.eyeBallY);
  }
  if (cfg.eyeExpression1 !== undefined) {
    setIfExists(core, "ParamEyeExpression1", cfg.eyeExpression1);
  }
  if (cfg.eyeExpression2 !== undefined) {
    setIfExists(core, "ParamEyeExpression2", cfg.eyeExpression2);
  }
  if (cfg.tongueOut !== undefined) {
    setIfExists(core, "ParamTongueOut", cfg.tongueOut);
  }
  if (cfg.jawOpen !== undefined) {
    setIfExists(core, "JawOpen", cfg.jawOpen);
  }
  if (cfg.mouthShrug !== undefined) {
    setIfExists(core, "MouthShrug", cfg.mouthShrug);
  }
  if (cfg.mouthPucker !== undefined) {
    setIfExists(core, "MouthPucker", cfg.mouthPucker);
  }
};

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

const readCurrentPose = (coreModel: any): Required<EmotionPose> => ({
  mouthForm: readParam(coreModel, ["ParamMouthForm", "ParamMouthSmile", "ParamMouthFormSmile", "ParamMouthWidth"], 0),
  mouthOpen: readParam(coreModel, ["ParamMouthOpenY", "ParamMouthOpen", "ParamMouthOpenSmile"], 0),
  mouthSmileLower: readParam(coreModel, ["ParamMouthForm2", "ParamMouthSmileLower", "ParamMouthLower"], 0),
  mouthX: readParam(coreModel, ["ParamMouthX"], 0),
  cheek: readParam(coreModel, ["ParamCheek", "ParamFlush", "ParamCheekSmile"], 0),
  cheekPuff: readParam(coreModel, ["ParamCheekPuff"], 0),
  eyeSmile: readParam(coreModel, ["ParamEyeLSmile", "ParamEyeLForm", "ParamEyeLSmileLine"], 0),
  eyeOpen: readParam(coreModel, ["ParamEyeLOpen", "ParamEyeLFormEyeOpen"], 1),
  browY: readParam(coreModel, ["ParamBrowLY", "ParamBrowLForm", "ParamBrowY", "ParamBrowLPosY"], 0),
  browX: readParam(coreModel, ["ParamEyeBrowX"], 0),
  pupilScale: readParam(coreModel, ["ParamEyeBallScaleX", "ParamEyeBallScaleY"], 1),
  angleX: readParam(coreModel, ["ParamAngleX"], 0),
  angleY: readParam(coreModel, ["ParamAngleY"], 0),
  angleZ: readParam(coreModel, ["ParamAngleZ"], 0),
  lowerLid: readParam(coreModel, ["ParamEyeLLower", "ParamEyeLowerLidL", "ParamEyeLSmile2"], 0),
  tongueOut: readParam(coreModel, ["ParamTongueOut"], 0),
  jawOpen: readParam(coreModel, ["JawOpen"], 0),
  mouthShrug: readParam(coreModel, ["MouthShrug"], 0),
  mouthPucker: readParam(coreModel, ["MouthPucker"], 0),
  eyeBallX: readParam(coreModel, ["ParamEyeBallX"], 0),
  eyeBallY: readParam(coreModel, ["ParamEyeBallY"], 0),
  eyeExpression1: readParam(coreModel, ["ParamEyeExpression1"], 0),
  eyeExpression2: readParam(coreModel, ["ParamEyeExpression2"], 0)
});

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

const mixPose = (from: Required<EmotionPose>, to: EmotionPose, t: number): Required<EmotionPose> => ({
  mouthForm: lerp(from.mouthForm ?? 0, to.mouthForm ?? from.mouthForm ?? 0, t),
  mouthOpen: lerp(from.mouthOpen ?? 0, to.mouthOpen ?? from.mouthOpen ?? 0, t),
  mouthSmileLower: lerp(from.mouthSmileLower ?? 0, to.mouthSmileLower ?? from.mouthSmileLower ?? 0, t),
  mouthX: lerp(from.mouthX ?? 0, to.mouthX ?? from.mouthX ?? 0, t),
  cheek: lerp(from.cheek ?? 0, to.cheek ?? from.cheek ?? 0, t),
  cheekPuff: lerp(from.cheekPuff ?? 0, to.cheekPuff ?? from.cheekPuff ?? 0, t),
  eyeSmile: lerp(from.eyeSmile ?? 0, to.eyeSmile ?? from.eyeSmile ?? 0, t),
  eyeOpen: lerp(from.eyeOpen ?? 0, to.eyeOpen ?? from.eyeOpen ?? 0, t),
  browY: lerp(from.browY ?? 0, to.browY ?? from.browY ?? 0, t),
  browX: lerp(from.browX ?? 0, to.browX ?? from.browX ?? 0, t),
  pupilScale: lerp(from.pupilScale ?? 1, to.pupilScale ?? from.pupilScale ?? 1, t),
  angleX: lerp(from.angleX ?? 0, to.angleX ?? from.angleX ?? 0, t),
  angleY: lerp(from.angleY ?? 0, to.angleY ?? from.angleY ?? 0, t),
  angleZ: lerp(from.angleZ ?? 0, to.angleZ ?? from.angleZ ?? 0, t),
  lowerLid: lerp(from.lowerLid ?? 0, to.lowerLid ?? from.lowerLid ?? 0, t),
  tongueOut: lerp(from.tongueOut ?? 0, to.tongueOut ?? from.tongueOut ?? 0, t),
  jawOpen: lerp(from.jawOpen ?? 0, to.jawOpen ?? from.jawOpen ?? 0, t),
  mouthShrug: lerp(from.mouthShrug ?? 0, to.mouthShrug ?? from.mouthShrug ?? 0, t),
  mouthPucker: lerp(from.mouthPucker ?? 0, to.mouthPucker ?? from.mouthPucker ?? 0, t),
  eyeBallX: lerp(from.eyeBallX ?? 0, to.eyeBallX ?? from.eyeBallX ?? 0, t),
  eyeBallY: lerp(from.eyeBallY ?? 0, to.eyeBallY ?? from.eyeBallY ?? 0, t),
  eyeExpression1: lerp(from.eyeExpression1 ?? 0, to.eyeExpression1 ?? from.eyeExpression1 ?? 0, t),
  eyeExpression2: lerp(from.eyeExpression2 ?? 0, to.eyeExpression2 ?? from.eyeExpression2 ?? 0, t)
});

let rafId: number | null = null;
let runningModel: Live2DModelLike | null = null;

export const playEmotion = (model: Live2DModelLike, emotion?: EmotionDefinition | null) => {
  if (!model || model._destroyed || !emotion || !emotion.keyframes?.length) return;

  if (rafId && runningModel === model) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const core = model.internalModel?.coreModel;
  if (!core) return;

  const frames = emotion.keyframes;
  let frameIndex = 0;
  let fromPose = readCurrentPose(core);
  let startTime = performance.now();

  const step = (now: number) => {
    const frame = frames[frameIndex];
    if (!frame) {
      rafId = null;
      return;
    }

    const duration = Math.max(frame.durationMs, 0);
    const progress = duration === 0 ? 1 : clamp01((now - startTime) / duration);
    const mixed = mixPose(fromPose, frame.params ?? {}, progress);
    applyPose(model, mixed);

    if (progress >= 1) {
      fromPose = mixed;
      frameIndex += 1;
      startTime = now;
      if (frameIndex >= frames.length) {
        rafId = null;
        return;
      }
    }

    rafId = requestAnimationFrame(step);
  };

  runningModel = model;
  rafId = requestAnimationFrame(step);
};
