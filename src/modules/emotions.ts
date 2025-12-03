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
};

const setIfExists = (coreModel: any, id: string, value: number) => {
  if (!coreModel?.setParameterValueById) return;
  try {
    coreModel.setParameterValueById(id, value);
  } catch (err) {
    // ignore missing params
  }
};

const applyEmotion = (model: Live2DModelLike, cfg: EmotionConfig) => {
  if (!model || model._destroyed) return;
  const core = model.internalModel?.coreModel;
  if (!core) return;

  setIfExists(core, "ParamMouthForm", cfg.mouthForm);
  setIfExists(core, "ParamMouthOpenY", cfg.mouthOpen);
  setIfExists(core, "ParamCheek", cfg.cheek);

  setIfExists(core, "ParamEyeLSmile", cfg.eyeSmile);
  setIfExists(core, "ParamEyeRSmile", cfg.eyeSmile);
  setIfExists(core, "ParamEyeLOpen", cfg.eyeOpen);
  setIfExists(core, "ParamEyeROpen", cfg.eyeOpen);

  setIfExists(core, "ParamBrowLY", cfg.browY);
  setIfExists(core, "ParamBrowRY", cfg.browY);
};

/**
 * Neutral emotion: relaxed mouth, neutral cheeks/eyes/brows.
 */
export const setNeutralEmotion = (model: Live2DModelLike) =>
  applyEmotion(model, {
    mouthForm: 0,
    mouthOpen: 0.05,
    cheek: 0,
    eyeSmile: 0,
    eyeOpen: 1,
    browY: 0
  });

/**
 * Happy emotion: smile curve, slight mouth open, blushing, eye smile, raised brows.
 */
export const setHappyEmotion = (model: Live2DModelLike) =>
  applyEmotion(model, {
    mouthForm: 0.9,
    mouthOpen: 0.2,
    cheek: 0.8,
    eyeSmile: 0.8,
    eyeOpen: 1,
    browY: 0.3
  });
