import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import * as PIXI from "pixi.js";
import { Ticker } from "@pixi/ticker";
import { playHappyEmotion, playSadEmotion, setNeutralEmotion } from "../modules/emotions";
import { createBlinkAnimator, createGazeAnimator } from "../modules/animation";

type Live2DModelType = typeof import("pixi-live2d-display/lib/cubism4").Live2DModel;
type ModelOption = { name: string; url: string };
type BustConfig = {
  scale: number;
  visibleFraction: number;
  offsetY: number;
  headOffsetX: number;
  headOffsetY: number;
  trackRadius: number;
};

type ViewMode = "bust" | "full";
type EmotionId = "neutral" | "happy" | "sad";
type EmotionOption = { id: EmotionId; label: string };

const DEFAULT_BUST_CONFIG: BustConfig = {
  scale: 1,
  visibleFraction: 0.5,
  offsetY: 0,
  headOffsetX: 0,
  headOffsetY: 0,
  trackRadius: 240
};
const CONFIG_API_URL = "/api/config";
const CONFIG_FILE_URL = "/model/config.json";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const EMOTION_OPTIONS: EmotionOption[] = [
  { id: "neutral", label: "Neutral" },
  { id: "happy", label: "Happy" },
  { id: "sad", label: "Sad" }
];

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

export default function Live2DViewer() {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([
    { name: "长离带水印", url: "/model/长离带水印/长离.model3.json" }
  ]);
  const [selectedModel, setSelectedModel] = useState("/model/长离带水印/长离.model3.json");
  const [viewMode, setViewMode] = useState<ViewMode>("bust");
  const [modelConfigs, setModelConfigs] = useState<Record<string, BustConfig>>({});
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [draftConfig, setDraftConfig] = useState<BustConfig | null>(null);
  const [zoom, setZoom] = useState(1);
  const [, setLoadingModels] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const bustConfigRef = useRef<BustConfig>(DEFAULT_BUST_CONFIG);
  const headOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const layoutRef = useRef<(() => void) | null>(null);
  const modelRef = useRef<any | null>(null);
  const crosshairRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ startY: number; startVisible: number; startOffset: number } | null>(
    null
  );
  const gazeAnimatorRef = useRef(createGazeAnimator());
  const blinkAnimatorRef = useRef(createBlinkAnimator());

  const normalizeConfig = (cfg?: Partial<BustConfig>): BustConfig => ({
    scale: cfg?.scale ?? DEFAULT_BUST_CONFIG.scale,
    visibleFraction: cfg?.visibleFraction ?? DEFAULT_BUST_CONFIG.visibleFraction,
    offsetY: cfg?.offsetY ?? DEFAULT_BUST_CONFIG.offsetY,
    headOffsetX: cfg?.headOffsetX ?? DEFAULT_BUST_CONFIG.headOffsetX,
    headOffsetY: cfg?.headOffsetY ?? DEFAULT_BUST_CONFIG.headOffsetY,
    trackRadius: cfg?.trackRadius ?? DEFAULT_BUST_CONFIG.trackRadius
  });

  const startSetDefault = () => {
    const base = normalizeConfig(modelConfigs[selectedModel]);
    setDraftConfig({ ...base });
    setIsSettingDefault(true);
  };

  const cancelSetDefault = () => {
    setDraftConfig(null);
    setIsSettingDefault(false);
  };

  const confirmSetDefault = () => {
    if (!draftConfig) return;
    const next = { ...modelConfigs, [selectedModel]: draftConfig };
    persistConfigs(next);
    setDraftConfig(null);
    setIsSettingDefault(false);
  };

  const applyEmotion = (emotion: EmotionId) => {
    const model = modelRef.current;
    if (!model) return;
    if (emotion === "neutral") {
      setNeutralEmotion(model);
    } else if (emotion === "happy") {
      playHappyEmotion(model);
    } else if (emotion === "sad") {
      playSadEmotion(model);
    }
  };

  const handleWheelAdjust = (e: ReactWheelEvent) => {
    if (!isSettingDefault || viewMode !== "bust") return;
    e.preventDefault();
    const delta = e.deltaY;
    setDraftConfig((prev) => {
      if (!prev) return prev;
      const factor = delta < 0 ? 0.97 : 1.03;
      const nextScale = clamp(prev.scale * factor, 0.3, 4);
      return { ...prev, scale: nextScale };
    });
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    if (!isSettingDefault || viewMode !== "bust") return;
    const canvas = canvasRef.current?.querySelector("canvas");
    const model = modelRef.current;
    if (!canvas || !model || model._destroyed) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const bounds = model.getBounds?.();
    if (!bounds || !bounds.contains(x, y)) return;

    dragStateRef.current = {
      startY: e.clientY,
      startVisible: draftConfig?.visibleFraction ?? DEFAULT_BUST_CONFIG.visibleFraction,
      startOffset: draftConfig?.offsetY ?? DEFAULT_BUST_CONFIG.offsetY
    };
  };

  const handleMouseUp = () => {
    dragStateRef.current = null;
  };

  const handleMouseMove = (e: ReactMouseEvent) => {
    if (!isSettingDefault || viewMode !== "bust") return;
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const deltaY = e.clientY - dragState.startY;
    setDraftConfig((prev) => {
      if (!prev) return prev;
      const nextOffset = dragState.startOffset + deltaY;
      const nextVisible = clamp(dragState.startVisible + deltaY * 0.0015, 0.1, 1.5);
      return { ...prev, offsetY: nextOffset, visibleFraction: nextVisible };
    });
  };

  const activeBustConfig = useMemo(() => {
    if (isSettingDefault && draftConfig) return draftConfig;
    return normalizeConfig(modelConfigs[selectedModel]);
  }, [draftConfig, isSettingDefault, modelConfigs, selectedModel]);

  const saveConfigsToFile = async (configs: Record<string, BustConfig>) => {
    try {
      const res = await fetch(CONFIG_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configs)
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Không lưu được config xuống file.", err);
    }
  };

  const persistConfigs = (nextConfigs: Record<string, BustConfig>) => {
    setModelConfigs(nextConfigs);
    void saveConfigsToFile(nextConfigs);
  };

  useEffect(() => {
    const loadManifest = async () => {
      try {
        const res = await fetch("/model/models.json", { cache: "no-store" });
        if (!res.ok) throw new Error("manifest not found");
        const data = (await res.json()) as ModelOption[];
        if (Array.isArray(data) && data.length) {
          setModelOptions(data);
          setSelectedModel((prev) => {
            const hasPrev = data.some((m) => m.url === prev);
            if (hasPrev) return prev;
            const jingliu = data.find((m) => m.name === "jingliu");
            return jingliu?.url ?? data[0].url;
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Không đọc được models.json, dùng fallback mặc định.", err);
      } finally {
        setLoadingModels(false);
      }
    };

    loadManifest();
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      const parseConfig = (data: unknown) =>
        data && typeof data === "object" ? (data as Record<string, BustConfig>) : {};

      const fetchConfigFromApi = async () => {
        const res = await fetch(CONFIG_API_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`API status ${res.status}`);
        const parsed = await res.json();
        return parseConfig(parsed);
      };

      const fetchConfigFromFile = async () => {
        const res = await fetch(CONFIG_FILE_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("config file not found");
        const parsed = await res.json();
        return parseConfig(parsed);
      };

      let loadedConfig: Record<string, BustConfig> = {};
      try {
        loadedConfig = await fetchConfigFromApi();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Không đọc được config qua API, thử file tĩnh.", err);
        try {
          loadedConfig = await fetchConfigFromFile();
        } catch (fileErr) {
          // eslint-disable-next-line no-console
          console.warn("Không đọc được config.json, dùng config mặc định.", fileErr);
        }
      }

      setModelConfigs(loadedConfig);
    };

    void loadConfig();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !selectedModel) return;
    let destroyed = false;

    const ensureCubismCore = async () => {
      if (window.Live2DCubismCore) return;

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Không tải được live2dcubismcore.min.js"));
        document.head.appendChild(script);
      });
    };

    const loadCubismModule = async (): Promise<Live2DModelType> => {
      const mod = await import("pixi-live2d-display/lib/cubism4");
      return mod.Live2DModel;
    };

    // pixi-live2d-display yêu cầu PIXI.Ticker.shared tồn tại trên window
    const globalPIXI = PIXI as any;
    if (!globalPIXI.Ticker) {
      globalPIXI.Ticker = Ticker;
    }
    (window as any).PIXI = globalPIXI;

    const app = new PIXI.Application({
      view: undefined,
      autoStart: true,
      transparent: true,
      width: window.innerWidth,
      height: window.innerHeight,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });

    canvasRef.current.innerHTML = "";
    canvasRef.current.appendChild(app.view as HTMLCanvasElement);

    let detachListeners: (() => void) | undefined;

    // Load runtime + model
    ensureCubismCore()
      .then(() => loadCubismModule())
      .then((Live2DModel) => {
        // Đăng ký class Ticker (không phải instance)
        if (typeof Live2DModel.registerTicker === "function") {
          Live2DModel.registerTicker(Ticker as any);
          // Đảm bảo shared ticker đã được khởi tạo/chạy
          const sharedTicker = (Ticker as any).shared;
          if (sharedTicker && typeof sharedTicker.start === "function") {
            sharedTicker.start();
          }
        }
        return Live2DModel.from(selectedModel);
      })
      .then((model: any) => {
        

// Tắt motion idle
model.internalModel.motionManager?.stopAllMotions?.();

// Tắt auto blink + mouth
model.internalModel.eyeBlink = null;
model.internalModel.mouthMovement = null;

// Tắt physics nếu có
if (model.internalModel.physics) {
    model.internalModel.physics._rigSettings = null;
    model.internalModel.physics._rig = null;
}

// Tắt auto focus theo chuột mặc định để không bị follow ngoài vùng cho phép
model.autoInteract = false;
model.interactive = false;
model.unregisterInteraction?.();
model.internalModel?.focusController?.focus(0, 0, true);



        if (destroyed) return;

        modelRef.current = model;

        const applyLayout = () => {
          if (!canvasRef.current) return;
          if (!model || (model as any)._destroyed || !(model as any).transform) return;

          const containerRect = canvasRef.current.getBoundingClientRect();
          const viewWidth = containerRect.width || window.innerWidth;
          const viewHeight = containerRect.height || window.innerHeight;

          // Kích thước gốc của model (chưa scale)
          const baseWidth = model.width / Math.max(model.scale.x, 0.0001);
          const baseHeight = model.height / Math.max(model.scale.y, 0.0001);

          // Anchor trên đỉnh để dễ kéo model lên/xuống
          model.anchor.set(0.5, 0);

          let finalScale = 1;
          let desiredWidth = viewWidth;
          let desiredHeight = viewHeight;

          if (viewMode === "full") {
            const baseScale =
              Math.min(viewWidth / baseWidth, viewHeight / baseHeight);
            finalScale = Math.max(baseScale * zoomRef.current, 0.25);

            const scaledWidth = baseWidth * finalScale;
            const scaledHeight = baseHeight * finalScale;

            desiredWidth = Math.max(viewWidth, scaledWidth + viewWidth * 0.08);
            desiredHeight = Math.max(viewHeight, scaledHeight);

            model.scale.set(finalScale);
            model.x = desiredWidth / 2;
            model.y = desiredHeight - scaledHeight;
          } else {
            // Bán thân: zoom lớn hơn và đẩy thấp xuống để chỉ thấy nửa trên
            const { visibleFraction, scale: bustScale, offsetY } = bustConfigRef.current;
            const safeVisible = Math.max(visibleFraction, 0.1);
            const baseScale = Math.min(
              (viewWidth * 0.95) / baseWidth,
              viewHeight / (baseHeight * safeVisible)
            );
            finalScale = Math.max(baseScale * zoomRef.current * bustScale, 0.35);

            const topPadding = 0;

            desiredWidth = viewWidth;
            desiredHeight = viewHeight;

            model.scale.set(finalScale);
            model.x = desiredWidth / 2;
            model.y = topPadding + offsetY;
          }

          // Resize renderer để phù hợp khung nhìn (full cho phép tràn/scroll, bust thì crop)
          app.renderer.resize(desiredWidth, desiredHeight);
        };

        layoutRef.current = applyLayout;

        applyLayout();

        const onResize = () => {
          if (!model._destroyed) applyLayout();
        };

        window.addEventListener("resize", onResize);

        app.stage.addChild(model);

        // Theo chuột trong vùng bán kính, ngoài vùng mắt nhìn thẳng
        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        let attention = 0;
        let state: "idle" | "tracking" = "idle";
        let smoothTarget = { x: 0, y: 0 };
        let nextGlanceAt = performance.now() + 10000;
        let glanceEndAt = 0;
        let glanceTarget = { x: 0, y: 0 };
        const damp = (current: number, target: number, rate: number) =>
          current + (target - current) * rate;

        const onMouseMove = (e: MouseEvent) => {
          mouseX = e.clientX;
          mouseY = e.clientY;
        };

        const updateGaze = (delta: number) => {
          if (model._destroyed) return;

          const offset = headOffsetRef.current;
          let centerX: number;
          let centerY: number;

          if (isSettingDefault && crosshairRef.current) {
            const rect = crosshairRef.current.getBoundingClientRect();
            centerX = rect.left + rect.width / 2;
            centerY = rect.top + rect.height / 2;
          } else {
            const containerRect = canvasRef.current?.getBoundingClientRect();
            centerX =
              (containerRect?.left ?? 0) + (containerRect?.width ?? window.innerWidth) / 2 + offset.x;
            centerY =
              (containerRect?.top ?? 0) + (containerRect?.height ?? window.innerHeight) / 2 + offset.y;
          }

          const radius = Math.max(
            bustConfigRef.current?.trackRadius ?? DEFAULT_BUST_CONFIG.trackRadius,
            10
          );

          const blinkOpen = blinkAnimatorRef.current.update(model, delta);

          gazeAnimatorRef.current.update({
            model,
            delta,
            center: { x: centerX, y: centerY },
            mouse: { x: mouseX, y: mouseY },
            trackRadius: radius,
            blinkOpen
          });
        };

        app.ticker.add(updateGaze);
        window.addEventListener("mousemove", onMouseMove);

        detachListeners = () => {
          app.ticker.remove(updateGaze);
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("resize", onResize);
        };
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Lỗi load Cubism/model:", err);
      });

    return () => {
      destroyed = true;
      detachListeners?.();
      layoutRef.current = null;
      modelRef.current = null;
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, [selectedModel, viewMode]);

  useEffect(() => {
    zoomRef.current = zoom;
    layoutRef.current?.();
  }, [zoom]);

  useEffect(() => {
    if (isSettingDefault) {
      const base = normalizeConfig(modelConfigs[selectedModel]);
      setDraftConfig({ ...base });
    }
  }, [isSettingDefault, modelConfigs, selectedModel]);

  useEffect(() => {
    bustConfigRef.current = activeBustConfig;
    headOffsetRef.current = {
      x: activeBustConfig.headOffsetX ?? 0,
      y: activeBustConfig.headOffsetY ?? 0
    };
    layoutRef.current?.();
  }, [activeBustConfig]);

  const workingConfig = draftConfig ?? activeBustConfig;

  const updateDraftConfig = (partial: Partial<BustConfig>) => {
    setDraftConfig((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: viewMode === "bust" ? "hidden" : "auto"
      }}
      onWheel={handleWheelAdjust}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseUp}
    >
      <ControlPanel
        modelOptions={modelOptions}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        zoom={zoom}
        onChangeZoom={(value) => setZoom(value)}
        isSettingDefault={isSettingDefault}
        onStartSetDefault={startSetDefault}
        onConfirmSetDefault={confirmSetDefault}
        onCancelSetDefault={cancelSetDefault}
        emotions={EMOTION_OPTIONS}
        onSelectEmotion={applyEmotion}
      />
      {viewMode === "bust" && isSettingDefault && (
        <BustEditorOverlay
          config={workingConfig}
          crosshairRef={crosshairRef}
          onChangeConfig={updateDraftConfig}
        />
      )}
      <div ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

type ControlPanelProps = {
  modelOptions: ModelOption[];
  selectedModel: string;
  onSelectModel: (value: string) => void;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  zoom: number;
  onChangeZoom: (value: number) => void;
  isSettingDefault: boolean;
  onStartSetDefault: () => void;
  onConfirmSetDefault: () => void;
  onCancelSetDefault: () => void;
  emotions: EmotionOption[];
  onSelectEmotion: (id: EmotionId) => void;
};

function ControlPanel({
  modelOptions,
  selectedModel,
  onSelectModel,
  viewMode,
  onChangeViewMode,
  zoom,
  onChangeZoom,
  isSettingDefault,
  onStartSetDefault,
  onConfirmSetDefault,
  onCancelSetDefault,
  emotions,
  onSelectEmotion
}: ControlPanelProps) {
  const [showEmotions, setShowEmotions] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 10,
        background: "rgba(0,0,0,0.5)",
        padding: "8px 12px",
        borderRadius: 8,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 8
      }}
    >
      <label style={{ fontSize: 14 }}>Chọn model:</label>
      <select
        value={selectedModel}
        onChange={(e) => onSelectModel(e.target.value)}
        style={{
          background: "#111",
          color: "#fff",
          border: "1px solid #555",
          borderRadius: 6,
          padding: "6px 8px",
          minWidth: 180
        }}
      >
        {modelOptions.map((opt) => (
          <option key={opt.url} value={opt.url}>
            {opt.name}
          </option>
        ))}
      </select>
      <label style={{ fontSize: 14 }}>Khung nhìn:</label>
      <select
        value={viewMode}
        onChange={(e) => onChangeViewMode(e.target.value as ViewMode)}
        style={{
          background: "#111",
          color: "#fff",
          border: "1px solid #555",
          borderRadius: 6,
          padding: "6px 8px",
          minWidth: 130
        }}
      >
        <option value="bust">Bán thân</option>
        <option value="full">Toàn thân</option>
      </select>
      <label style={{ fontSize: 14 }}>Zoom:</label>
      <input
        type="range"
        min={50}
        max={200}
        value={Math.round(zoom * 100)}
        onChange={(e) => onChangeZoom(Number(e.target.value) / 100)}
        style={{ width: 120 }}
      />
      <span style={{ fontSize: 13, minWidth: 42 }}>{Math.round(zoom * 100)}%</span>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowEmotions((prev) => !prev)}
          style={{
            background: "#8e44ad",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 10px",
            cursor: "pointer"
          }}
        >
          Emotions
        </button>
        {showEmotions && (
          <div
            style={{
              position: "absolute",
              top: "110%",
              left: 0,
              background: "#111",
              border: "1px solid #555",
              borderRadius: 8,
              padding: 8,
              display: "flex",
              gap: 6,
              zIndex: 20
            }}
          >
            {emotions.map((emotion) => (
              <button
                key={emotion.id}
                onClick={() => {
                  onSelectEmotion(emotion.id);
                  setShowEmotions(false);
                }}
                style={{
                  background: "#2c3e50",
                  color: "#fff",
                  border: "1px solid #555",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: "pointer",
                  minWidth: 80
                }}
              >
                {emotion.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {viewMode === "bust" && (
        <>
          <button
            onClick={isSettingDefault ? onConfirmSetDefault : onStartSetDefault}
            style={{
              background: isSettingDefault ? "#2ecc71" : "#3498db",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer"
            }}
          >
            {isSettingDefault ? "OK" : "Set default"}
          </button>
          {isSettingDefault && (
            <button
              onClick={onCancelSetDefault}
              style={{
                background: "#e74c3c",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer"
              }}
            >
              Hủy
            </button>
          )}
        </>
      )}
    </div>
  );
}

type BustEditorOverlayProps = {
  config: BustConfig;
  crosshairRef: RefObject<HTMLDivElement | null>;
  onChangeConfig: (partial: Partial<BustConfig>) => void;
};

function BustEditorOverlay({ config, crosshairRef, onChangeConfig }: BustEditorOverlayProps) {
  const { headOffsetX, headOffsetY, trackRadius, scale, visibleFraction, offsetY } = config;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) translate(${headOffsetX}px, ${headOffsetY}px)`,
          pointerEvents: "none",
          zIndex: 9,
          width: 18,
          height: 18
        }}
        ref={crosshairRef}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            transform: "translateX(-50%)",
            background: "rgba(0, 200, 255, 0.9)"
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: 1,
            transform: "translateY(-50%)",
            background: "rgba(0, 200, 255, 0.9)"
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -50%) translate(${headOffsetX}px, ${headOffsetY}px)`,
          width: (trackRadius || DEFAULT_BUST_CONFIG.trackRadius) * 2,
          height: (trackRadius || DEFAULT_BUST_CONFIG.trackRadius) * 2,
          borderRadius: "50%",
          border: "1px dashed rgba(0, 200, 255, 0.6)",
          pointerEvents: "none",
          zIndex: 8,
          boxSizing: "border-box"
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: 10,
          fontSize: 13,
          display: "flex",
          gap: 12,
          alignItems: "center"
        }}
      >
        <span>Chế độ đặt mặc định (Bán thân)</span>
        <span>Cuộn chuột: chỉnh scale</span>
        <span>Kéo lên/xuống: chỉnh phần hiển thị</span>
        <span>
          Scale: {scale.toFixed(2)} | Visible: {visibleFraction.toFixed(2)} | OffsetY:{" "}
          {Math.round(offsetY)} | Radius: {Math.round(trackRadius)}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Head X:</span>
          <input
            type="range"
            min={-400}
            max={400}
            step={5}
            value={headOffsetX}
            onChange={(e) => onChangeConfig({ headOffsetX: Number(e.target.value) })}
            style={{ width: 120 }}
          />
          <span style={{ minWidth: 40, textAlign: "right" }}>{headOffsetX}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Head Y:</span>
          <input
            type="range"
            min={-400}
            max={400}
            step={5}
            value={headOffsetY}
            onChange={(e) => onChangeConfig({ headOffsetY: Number(e.target.value) })}
            style={{ width: 120 }}
          />
          <span style={{ minWidth: 40, textAlign: "right" }}>{headOffsetY}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>Head Radius:</span>
          <input
            type="range"
            min={60}
            max={500}
            step={5}
            value={trackRadius}
            onChange={(e) => onChangeConfig({ trackRadius: Number(e.target.value) })}
            style={{ width: 140 }}
          />
          <span style={{ minWidth: 46, textAlign: "right" }}>{trackRadius}</span>
        </div>
      </div>
    </>
  );
}
