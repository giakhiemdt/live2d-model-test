type Live2DModelLike = {
  internalModel?: { coreModel?: any };
  _destroyed?: boolean;
};

type BlinkState = {
  nextBlinkAt: number;
  phase: "idle" | "closing" | "closed" | "opening" | "settle";
  phaseEndsAt: number;
};

type GazeState = {
  attention: number;
  state: "idle" | "tracking";
  smoothTarget: { x: number; y: number };
  nextGlanceAt: number;
  glanceEndAt: number;
  glanceTarget: { x: number; y: number };
};

type GazeUpdateInput = {
  model: Live2DModelLike;
  delta: number;
  center: { x: number; y: number };
  mouse: { x: number; y: number };
  trackRadius: number;
  blinkOpen: number;
};

const setIfExists = (coreModel: any, id: string, value: number) => {
  if (!coreModel?.setParameterValueById) return;
  try {
    coreModel.setParameterValueById(id, value);
  } catch {
    // silently ignore missing params
  }
};

export const createBlinkAnimator = () => {
  const state: BlinkState = {
    nextBlinkAt: performance.now() + 2200 + Math.random() * 3600,
    phase: "idle",
    phaseEndsAt: 0
  };

  const scheduleNext = () => {
    state.nextBlinkAt = performance.now() + 2200 + Math.random() * 3600;
    state.phase = "idle";
    state.phaseEndsAt = 0;
  };

  const startBlink = () => {
    const now = performance.now();
    state.phase = "closing";
    state.phaseEndsAt = now + 120;
  };

  const progress = (now: number) => {
    if (state.phaseEndsAt <= now) return 1;
    const total = state.phaseEndsAt - (state.phase === "closing"
      ? state.phaseEndsAt - 120
      : state.phase === "closed"
        ? state.phaseEndsAt - 80
        : state.phase === "opening"
          ? state.phaseEndsAt - 140
          : state.phaseEndsAt - 120);
    const spent = total - (state.phaseEndsAt - now);
    return Math.min(Math.max(spent / total, 0), 1);
  };

  return {
    update(model: Live2DModelLike, _delta: number): number {
      if (!model || model._destroyed) return 1;
      const core = model.internalModel?.coreModel;
      const now = performance.now();

      if (state.phase === "idle" && now >= state.nextBlinkAt) {
        startBlink();
      }

      if (state.phase === "closing") {
        const t = progress(now);
        const eyeOpen = 1 - t;
        const pupil = 1 + 0.08 * t;
        setIfExists(core, "ParamEyeBallScaleX", pupil);
        setIfExists(core, "ParamEyeBallScaleY", pupil);
        if (now >= state.phaseEndsAt) {
          state.phase = "closed";
          state.phaseEndsAt = now + 80;
        }
        return eyeOpen;
      }

      if (state.phase === "closed") {
        setIfExists(core, "ParamEyeBallScaleX", 1.08);
        setIfExists(core, "ParamEyeBallScaleY", 1.08);
        if (now >= state.phaseEndsAt) {
          state.phase = "opening";
          state.phaseEndsAt = now + 140;
        }
        return 0;
      }

      if (state.phase === "opening") {
        const t = progress(now);
        const eyeOpen = t;
        const pupil = 1.08 - 0.18 * t; // shrink slightly
        setIfExists(core, "ParamEyeBallScaleX", pupil);
        setIfExists(core, "ParamEyeBallScaleY", pupil);
        if (now >= state.phaseEndsAt) {
          state.phase = "settle";
          state.phaseEndsAt = now + 120;
        }
        return eyeOpen;
      }

      if (state.phase === "settle") {
        const t = progress(now);
        const pupil = 0.9 + (1 - 0.9) * t;
        setIfExists(core, "ParamEyeBallScaleX", pupil);
        setIfExists(core, "ParamEyeBallScaleY", pupil);
        if (now >= state.phaseEndsAt) {
          scheduleNext();
        }
        return 1;
      }

      return 1;
    }
  };
};

export const createGazeAnimator = () => {
  const state: GazeState = {
    attention: 0,
    state: "idle",
    smoothTarget: { x: 0, y: 0 },
    nextGlanceAt: performance.now() + 10000,
    glanceEndAt: 0,
    glanceTarget: { x: 0, y: 0 }
  };

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const damp = (current: number, target: number, rate: number) =>
    current + (target - current) * rate;

  return {
    update(input: GazeUpdateInput) {
      const { model, delta, center, mouse, trackRadius, blinkOpen } = input;
      if (!model || model._destroyed) return;
      const core = model.internalModel?.coreModel;
      if (!core) return;

      const dx = mouse.x - center.x;
      const dy = mouse.y - center.y;
      const distance = Math.hypot(dx, dy);
      const radius = Math.max(trackRadius, 10);
      const withinCircle = distance <= radius;

      let x = dx / radius;
      let y = dy / radius;
      x = clamp(x, -1, 1);
      y = clamp(y, -1, 1);

      const now = performance.now();
      const isGlancing = now < state.glanceEndAt;

      let activeX = 0;
      let activeY = 0;
      let targetAttention = 0;

      if (withinCircle) {
        state.state = "tracking";
        targetAttention = 1;
        activeX = x;
        activeY = y;
        state.nextGlanceAt = now + 10000 + Math.random() * 8000;
      } else {
        if (now >= state.nextGlanceAt) {
          state.glanceTarget = { x, y };
          state.glanceEndAt = now + 2200;
          state.nextGlanceAt = now + 10000 + Math.random() * 8000;
        }

        if (isGlancing) {
          targetAttention = 0.6;
          activeX = state.glanceTarget.x;
          activeY = state.glanceTarget.y;
        } else {
          if (state.state === "tracking") state.state = "idle";
          targetAttention = 0;
          activeX = 0;
          activeY = 0;
        }
      }

      const blendSpeed = withinCircle ? 0.08 : isGlancing ? 0.03 : 0.02;
      state.smoothTarget.x = damp(state.smoothTarget.x, activeX, blendSpeed * delta);
      state.smoothTarget.y = damp(state.smoothTarget.y, activeY, blendSpeed * delta);

      const speed = (withinCircle ? 0.06 : isGlancing ? 0.035 : 0.02) * delta;
      if (state.attention < targetAttention) {
        state.attention = Math.min(state.attention + speed, targetAttention);
      } else {
        state.attention = Math.max(state.attention - speed, targetAttention);
      }

      const headIntensity = 30 * state.attention;
      setIfExists(core, "ParamAngleX", state.smoothTarget.x * headIntensity);
      setIfExists(core, "ParamAngleY", -state.smoothTarget.y * headIntensity);

      const eyeSensitivity = 0.35 * state.attention;
      setIfExists(core, "ParamEyeBallX", state.smoothTarget.x * eyeSensitivity);
      setIfExists(core, "ParamEyeBallY", -state.smoothTarget.y * eyeSensitivity);

      const finalEyeOpen = blinkOpen;
      setIfExists(core, "ParamEyeLOpen", finalEyeOpen);
      setIfExists(core, "ParamEyeROpen", finalEyeOpen);
    }
  };
};
