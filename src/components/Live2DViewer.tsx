import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import * as PIXI from "pixi.js";
import { Ticker } from "@pixi/ticker";
import { playEmotion, type EmotionDefinition, type EmotionKeyframe, type EmotionPose } from "../modules/emotions";
import { createBlinkAnimator, createGazeAnimator } from "../modules/animation";
import { buildVtuberSystemPrompt, sendChatCompletion, type ChatMessage } from "../modules/chatApi";

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
type EmotionId = string;
type OverlayEffect = { id: string; label: string; description?: string; paramId: string; value?: number };
type UserNote = { text: string };
type ChatMessageState = ChatMessage;
type ChatSession = { id: string; title: string; messages: ChatMessageState[] };
const EMOTION_HOTKEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", "q", "w", "e"];

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
const EMOTION_API_URL = "/api/emotions";
const EMOTION_FILE_URL = "/model/emotions.json";
const USER_PROFILE_API_URL = "/api/user-profile";
const CHAT_STORAGE_KEY = "live2d-chat-sessions";
const DEFAULT_EMOTIONS: EmotionDefinition[] = [
  {
    id: "neutral",
    label: "Neutral",
    keyframes: [
      {
        durationMs: 0,
        params: {
          mouthForm: 0,
          mouthOpen: 0.05,
          cheek: 0,
          eyeSmile: 0,
          eyeOpen: 1,
          browY: 0,
          pupilScale: 1,
          angleZ: 0,
          lowerLid: 0
        }
      }
    ]
  }
];
const OVERLAY_EFFECTS: OverlayEffect[] = [
  { id: "overlay1", label: "1. 爱心眼", description: "Đôi mắt hình trái tim", paramId: "Button1", value: 1 },
  { id: "overlay2", label: "2. 白眼", description: "Trợn mắt (lật trắng)", paramId: "Button2", value: 1 },
  { id: "overlay3", label: "3. 黑脸", description: "Mặt tối lại", paramId: "Button7", value: 1 },
  { id: "overlay4", label: "4. 脸红", description: "Má ửng hồng", paramId: "Button3", value: 1 },
  { id: "overlay5", label: "5. 生气", description: "Ký hiệu giận dữ", paramId: "Button4", value: 1 },
  { id: "overlay6", label: "6. 外套穿脱", description: "Khoác/tháo áo", paramId: "Button5", value: 1 },
  { id: "overlay7", label: "7. 眼罩", description: "Đeo/Tháo bịt mắt", paramId: "Button6", value: 1 }
];
const EMOTION_PARAM_CONTROLS: Array<{
  key: keyof EmotionPose;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "mouthForm", label: "Mouth form", min: -1, max: 1, step: 0.02 },
  { key: "mouthSmileLower", label: "Mouth lower", min: -1, max: 1, step: 0.02 },
  { key: "mouthOpen", label: "Mouth open", min: 0, max: 2, step: 0.02 },
  { key: "mouthX", label: "Mouth X", min: -1, max: 1, step: 0.02 },
  { key: "cheek", label: "Cheek", min: -1, max: 2, step: 0.02 },
  { key: "cheekPuff", label: "Cheek puff", min: 0, max: 2, step: 0.02 },
  { key: "eyeSmile", label: "Eye smile", min: -1, max: 2, step: 0.02 },
  { key: "eyeOpen", label: "Eye open", min: 0, max: 2, step: 0.02 },
  { key: "lowerLid", label: "Lower lid", min: -1, max: 1, step: 0.02 },
  { key: "browX", label: "Brow X", min: -1, max: 1, step: 0.02 },
  { key: "browY", label: "Brow Y", min: -1, max: 1, step: 0.02 },
  { key: "pupilScale", label: "Pupil", min: 0.5, max: 1.5, step: 0.01 },
  { key: "angleX", label: "Angle X", min: -30, max: 30, step: 0.5 },
  { key: "angleY", label: "Angle Y", min: -30, max: 30, step: 0.5 },
  { key: "angleZ", label: "Angle Z", min: -30, max: 30, step: 0.5 },
  { key: "eyeBallX", label: "EyeBall X", min: -1.5, max: 1.5, step: 0.02 },
  { key: "eyeBallY", label: "EyeBall Y", min: -1.5, max: 1.5, step: 0.02 },
  { key: "eyeExpression1", label: "Eye Expr 1", min: -1, max: 1, step: 0.02 },
  { key: "eyeExpression2", label: "Eye Expr 2", min: -1, max: 1, step: 0.02 },
  { key: "tongueOut", label: "Tongue", min: 0, max: 1.2, step: 0.02 },
  { key: "jawOpen", label: "Jaw open", min: 0, max: 1.5, step: 0.02 },
  { key: "mouthShrug", label: "Mouth shrug", min: -1, max: 1, step: 0.02 },
  { key: "mouthPucker", label: "Mouth pucker", min: -1, max: 1, step: 0.02 }
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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
  const [emotions, setEmotions] = useState<EmotionDefinition[]>(DEFAULT_EMOTIONS);
  const [selectedEmotionId, setSelectedEmotionId] = useState<EmotionId>("neutral");
  const [isEmotionStudioOpen, setEmotionStudioOpen] = useState(false);
  const [emotionDraft, setEmotionDraft] = useState<EmotionDefinition | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [userNotes, setUserNotes] = useState<UserNote[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isChatCollapsed, setChatCollapsed] = useState(false);
  const [isChatInitialized, setChatInitialized] = useState(false);
  const [hasBootstrappedSession, setHasBootstrappedSession] = useState(false);
  const typingTimersRef = useRef<number[]>([]);
  const [modelConfigs, setModelConfigs] = useState<Record<string, BustConfig>>({});
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [draftConfig, setDraftConfig] = useState<BustConfig | null>(null);
  const [zoom, setZoom] = useState(1);
  const [overlayStates, setOverlayStates] = useState<Record<string, number>>(
    () => OVERLAY_EFFECTS.reduce((acc, eff) => ({ ...acc, [eff.paramId]: 0 }), {})
  );
  const [isChatInputFocused, setChatInputFocused] = useState(false);
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
  const draftPreviewTimeoutRef = useRef<number | null>(null);
  const emotionHotkeyMap = useMemo(
    () =>
      emotions.map((emo, idx) => ({
        ...emo,
        hotkey: EMOTION_HOTKEYS[idx] ?? ""
      })),
    [emotions]
  );
  const activeChat = useMemo(
    () => chatSessions.find((s) => s.id === activeChatId) ?? chatSessions[0],
    [activeChatId, chatSessions]
  );

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

  const applyEmotionById = useCallback(
    (emotionId: EmotionId) => {
      const model = modelRef.current;
      if (!model) return;
      const neutral = emotions.find((e) => e.id === "neutral") ?? emotions[0] ?? null;
      const targetId =
        selectedEmotionId === emotionId && emotionId !== neutral?.id ? neutral?.id : emotionId;
      const def = emotions.find((e) => e.id === targetId) ?? neutral ?? emotions[0];
      if (def) {
        playEmotion(model, def);
        setSelectedEmotionId(def.id);
      }
    },
    [emotions, selectedEmotionId]
  );

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

  const ensureChatTitle = (session: ChatSession, fallback: string) => {
    if (session.title && session.title.trim()) return session.title;
    const firstUser = session.messages.find((m) => m.role === "user");
    if (firstUser?.content) return firstUser.content.slice(0, 40);
    return fallback;
  };

  const clearTypingTimers = () => {
    typingTimersRef.current.forEach((id) => clearTimeout(id));
    typingTimersRef.current = [];
  };

  const playAssistantMessages = (sessionId: string, messages: string[]) => {
    if (!messages.length) return;
    clearTypingTimers();
    setIsTyping(true);

    let elapsed = 0;
    messages.forEach((msg, idx) => {
      const delay = Math.min(Math.max(msg.length * 25, 400), 1600);
      elapsed += delay;
      const timer = window.setTimeout(() => {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: [...s.messages, { role: "assistant" as const, content: msg }]
        }));
        if (idx === messages.length - 1) {
          setIsTyping(false);
        }
      }, elapsed);
      typingTimersRef.current.push(timer);
    });
  };

  const startNewChat = () => {
    const sessionId = `session-${Date.now()}`;
    setChatSessions((prev) => {
      const newSession: ChatSession = {
        id: sessionId,
        title: `Session ${prev.length + 1}`,
        messages: []
      };
      return [newSession, ...prev];
    });
    setActiveChatId(sessionId);
    setChatInput("");
  };

  const updateSession = (sessionId: string, updater: (s: ChatSession) => ChatSession) => {
    setChatSessions((prev) => prev.map((s) => (s.id === sessionId ? updater(s) : s)));
  };

  const sendChat = async () => {
    if (!activeChat) return;
    const content = chatInput.trim();
    if (!content || isSendingChat) return;
    setIsSendingChat(true);
    setChatError(null);
    const userMsg: ChatMessageState = { role: "user", content };
    updateSession(activeChat.id, (s) => ({ ...s, messages: [...s.messages, userMsg] }));
    setChatInput("");
    try {
      const recentMessages = (activeChat?.messages ?? []).slice(-20);
      const sessionMessages = [...recentMessages, userMsg];
      const systemPrompt = buildVtuberSystemPrompt(
        emotionHotkeyMap.map((e) => ({ id: e.id, label: e.label, description: e.label })),
        OVERLAY_EFFECTS.map((o, idx) => ({
          id: o.id,
          label: o.label,
          paramId: o.paramId,
          hotkey: String(idx + 1),
          description: o.description
        })),
        JSON.stringify({ notes: userNotes }, null, 2)
      );
      const assistantContent = await sendChatCompletion(sessionMessages, systemPrompt);

      let parsedAnswer = assistantContent;
      let parsedMessages: string[] | undefined;
      let parsedEmotion: string | undefined;
      let parsedOverlays: string[] | undefined;
      let parsedUserNotes: UserNote[] | undefined;
      try {
        const parsed = JSON.parse(assistantContent);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.answer === "string") parsedAnswer = parsed.answer;
          if (Array.isArray(parsed.messages)) {
            parsedMessages = parsed.messages
              .filter(
                (m: any) =>
                  m &&
                  typeof m === "object" &&
                  typeof m.text === "string" &&
                  ["reply", "comment", "question"].includes(m.type)
              )
              .map((m: any) => m.text);
          }
          if (typeof parsed.emotionId === "string") parsedEmotion = parsed.emotionId;
          if (Array.isArray(parsed.overlays)) {
            parsedOverlays = parsed.overlays.filter((o: unknown) => typeof o === "string") as string[];
          }
          if (Array.isArray(parsed.userNotes)) {
            parsedUserNotes = parsed.userNotes
              .filter((n: any) => n && typeof n.text === "string")
              .map((n: any) => ({ text: n.text as string }));
          }
        }
      } catch {
        // ignore JSON parse errors, fallback to raw content
      }

      if (parsedEmotion) {
        applyEmotionById(parsedEmotion);
      }
      if (parsedOverlays) {
        setOverlaysActive(parsedOverlays);
      }
      if (parsedUserNotes && parsedUserNotes.length) {
        const combined = [...userNotes];
        parsedUserNotes.forEach((note) => {
          if (!combined.some((n) => n.text === note.text)) combined.push(note);
        });
        void persistUserNotes(combined);
      }

      const assistantMessages = parsedMessages && parsedMessages.length ? parsedMessages : [parsedAnswer];
      updateSession(activeChat.id, (s) => ({
        ...s,
        title: ensureChatTitle(s, s.title)
      }));
      playAssistantMessages(activeChat.id, assistantMessages);
    } catch (err: any) {
      setChatError(err?.message ?? "Chat error");
      updateSession(activeChat.id, (s) => ({
        ...s,
        messages: [...s.messages, { role: "assistant", content: "Xin lỗi, tôi không trả lời được." }]
      }));
    } finally {
      setIsSendingChat(false);
    }
  };

  const startEditingEmotion = (emotionId?: EmotionId) => {
    const base =
      emotions.find((e) => e.id === emotionId) ??
      ({
        id: `custom-${Date.now()}`,
        label: "New emotion",
        keyframes: [
          { durationMs: 300, params: { mouthForm: 0, mouthOpen: 0.05 } },
          { durationMs: 300, params: { mouthForm: 0.3, mouthOpen: 0.05 } }
        ]
      } as EmotionDefinition);

    const clone = {
      ...base,
      keyframes: base.keyframes.map((kf) => ({ ...kf, params: { ...kf.params } }))
    };
    setEmotionDraft(clone);
    setEmotionStudioOpen(true);
  };

  const updateEmotionDraft = (partial: Partial<EmotionDefinition>) => {
    setEmotionDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const updateKeyframe = (
    index: number,
    updater: (frame: EmotionKeyframe) => EmotionKeyframe
  ) => {
    setEmotionDraft((prev) => {
      if (!prev) return prev;
      const nextFrames = prev.keyframes.map((kf, i) => (i === index ? updater(kf) : kf));
      return { ...prev, keyframes: nextFrames };
    });
  };

  const addKeyframe = () => {
    setEmotionDraft((prev) => {
      if (!prev) return prev;
      const last = prev.keyframes[prev.keyframes.length - 1];
      const fallbackParams: EmotionPose = last ? { ...last.params } : {};
      const nextFrame: EmotionKeyframe = { durationMs: 300, params: fallbackParams };
      return { ...prev, keyframes: [...prev.keyframes, nextFrame] };
    });
  };

  const removeKeyframe = (index: number) => {
    setEmotionDraft((prev) => {
      if (!prev) return prev;
      if (prev.keyframes.length <= 1) return prev;
      return { ...prev, keyframes: prev.keyframes.filter((_, i) => i !== index) };
    });
  };

  const saveEmotion = () => {
    if (!emotionDraft) return;
    const trimmedId = emotionDraft.id.trim() || `custom-${Date.now()}`;
    const sanitizedDraft = { ...emotionDraft, id: trimmedId };
    const nextList = [...emotions.filter((e) => e.id !== sanitizedDraft.id), sanitizedDraft];
    persistEmotions(nextList);
    setSelectedEmotionId(sanitizedDraft.id);
    setEmotionDraft(sanitizedDraft);
  };

  const playEmotionDraft = () => {
    if (!emotionDraft || !modelRef.current) return;
    playEmotion(modelRef.current, emotionDraft);
  };

  // Live preview emotion draft with debounce to reduce lag
  useEffect(() => {
    if (!isEmotionStudioOpen || !emotionDraft) return;
    if (draftPreviewTimeoutRef.current) {
      clearTimeout(draftPreviewTimeoutRef.current);
      draftPreviewTimeoutRef.current = null;
    }
    draftPreviewTimeoutRef.current = window.setTimeout(() => {
      playEmotionDraft();
    }, 500);

    return () => {
      if (draftPreviewTimeoutRef.current) {
        clearTimeout(draftPreviewTimeoutRef.current);
        draftPreviewTimeoutRef.current = null;
      }
    };
  }, [emotionDraft, isEmotionStudioOpen]);

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

  const saveEmotionsToFile = async (defs: EmotionDefinition[]) => {
    try {
      const res = await fetch(EMOTION_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defs)
      });
      if (!res.ok) throw new Error(`Save emotions failed: ${res.status}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Không lưu được emotions xuống file.", err);
    }
  };

  const persistEmotions = (next: EmotionDefinition[]) => {
    setEmotions(next);
    void saveEmotionsToFile(next);
  };

  const persistUserNotes = async (notes: UserNote[]) => {
    setUserNotes(notes);
    try {
      await fetch(USER_PROFILE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes })
      });
    } catch {
      // ignore save error
    }
  };

  const applyOverlayParams = (states: Record<string, number>) => {
    const model = modelRef.current;
    if (!model || model._destroyed) return;
    const core = model.internalModel?.coreModel;
    if (!core) return;
    Object.entries(states).forEach(([paramId, value]) => {
      try {
        core.setParameterValueById?.(paramId, value);
      } catch {
        // ignore missing
      }
    });
  };

  const toggleOverlay = (effect: OverlayEffect) => {
    setOverlayStates((prev) => {
      const nextValue = prev[effect.paramId] === (effect.value ?? 1) ? 0 : effect.value ?? 1;
      const next = { ...prev, [effect.paramId]: nextValue };
      applyOverlayParams(next);
      return next;
    });
  };

  const setOverlaysActive = (overlayIds: string[]) => {
    const targetIds = new Set(overlayIds);
    const next: Record<string, number> = {};
    OVERLAY_EFFECTS.forEach((eff) => {
      next[eff.paramId] = targetIds.has(eff.id) ? eff.value ?? 1 : 0;
    });
    setOverlayStates(next);
    applyOverlayParams(next);
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
    const loadEmotions = async () => {
      const parse = (data: unknown) =>
        Array.isArray(data) ? (data as EmotionDefinition[]) : DEFAULT_EMOTIONS;

      const fetchEmotionsFromApi = async () => {
        const res = await fetch(EMOTION_API_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`API status ${res.status}`);
        const parsed = await res.json();
        return parse(parsed);
      };

      const fetchEmotionsFromFile = async () => {
        const res = await fetch(EMOTION_FILE_URL, { cache: "no-store" });
        if (!res.ok) throw new Error("emotions file not found");
        const parsed = await res.json();
        return parse(parsed);
      };

      let loaded: EmotionDefinition[] = DEFAULT_EMOTIONS;
      try {
        loaded = await fetchEmotionsFromApi();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Không đọc được emotions qua API, thử file tĩnh.", err);
        try {
          loaded = await fetchEmotionsFromFile();
        } catch (fileErr) {
          // eslint-disable-next-line no-console
          console.warn("Không đọc được emotions.json, dùng mặc định.", fileErr);
        }
      }

      setEmotions(loaded);
      const hasSelected = loaded.some((e) => e.id === selectedEmotionId);
      if (!hasSelected && loaded[0]) {
        setSelectedEmotionId(loaded[0].id);
      }
    };

    void loadEmotions();
  }, []);

  useEffect(() => {
    const loadUserNotes = async () => {
      try {
        const res = await fetch(USER_PROFILE_API_URL, { cache: "no-store" });
        if (res.ok) {
          const parsed = await res.json();
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.notes)) {
            const notes = parsed.notes
              .filter((n: any) => n && typeof n.text === "string")
              .map((n: any) => ({ text: n.text as string }));
            setUserNotes(notes);
          }
        }
      } catch {
        // ignore load error
      }
    };

    void loadUserNotes();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatSession[];
        if (Array.isArray(parsed)) {
          setChatSessions(parsed);
          setActiveChatId(parsed[0]?.id ?? "");
          setChatInitialized(true);
          return;
        }
      }
    } catch {
      // ignore
    }

    setChatSessions([]);
    setActiveChatId("");
    setChatInitialized(true);
  }, []);

  useEffect(() => {
    if (!isChatInitialized || hasBootstrappedSession) return;
    startNewChat();
    setHasBootstrappedSession(true);
  }, [hasBootstrappedSession, isChatInitialized]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatSessions));
    } catch {
      // ignore
    }
  }, [chatSessions]);

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
      clearTypingTimers();
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

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const def =
      emotions.find((e) => e.id === selectedEmotionId) ??
      emotions.find((e) => e.id === "neutral") ??
      emotions[0];
    if (def) {
      playEmotion(model, def);
    }
  }, [emotions, selectedEmotionId]);

  useEffect(() => {
    applyOverlayParams(overlayStates);
  }, [overlayStates]);

  useEffect(() => {
    applyOverlayParams(overlayStates);
  }, [modelRef.current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key);
      if (!Number.isInteger(idx) || idx <= 0) return;
      const effect = OVERLAY_EFFECTS[idx - 1];
      if (effect) {
        e.preventDefault();
        toggleOverlay(effect);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const match = emotionHotkeyMap.find((emo) => emo.hotkey && emo.hotkey === key);
      if (match) {
        e.preventDefault();
        applyEmotionById(match.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [emotionHotkeyMap, applyEmotionById]);

  const workingConfig = draftConfig ?? activeBustConfig;

  const updateDraftConfig = (partial: Partial<BustConfig>) => {
    setDraftConfig((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#0a0c0f" }}>
      <ChatPanel
        sessions={chatSessions}
        activeSession={activeChat}
        onSelectSession={(id) => setActiveChatId(id)}
        onNewSession={startNewChat}
        input={chatInput}
        onChangeInput={setChatInput}
        onSend={sendChat}
        isSending={isSendingChat}
        error={chatError}
        isTyping={isTyping}
        isCollapsed={isChatCollapsed}
        onToggleCollapse={() => setChatCollapsed((prev) => !prev)}
        onFocusInput={() => setChatInputFocused(true)}
        onBlurInput={() => setChatInputFocused(false)}
      />
      <div
        style={{
          position: "relative",
          flex: isChatCollapsed ? 1 : 7,
          height: "100vh",
          overflow: viewMode === "bust" ? "hidden" : "auto",
          transition: "flex 0.25s ease"
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
        />
        {viewMode === "bust" && isSettingDefault && (
          <BustEditorOverlay
            config={workingConfig}
            crosshairRef={crosshairRef}
            onChangeConfig={updateDraftConfig}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 12,
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 12
          }}
        >
          {emotionHotkeyMap.map((emo, idx) => (
            <button
              key={emo.id}
              onClick={() => applyEmotionById(emo.id)}
              disabled={isChatInputFocused}
              style={{
                minWidth: 150,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                background: selectedEmotionId === emo.id ? "#8e44ad" : "rgba(0,0,0,0.6)",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: 8,
                cursor: isChatInputFocused ? "not-allowed" : "pointer",
                boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
                opacity: isChatInputFocused ? 0.5 : 1
              }}
            >
              <span style={{ fontWeight: 700 }}>{emo.hotkey?.toUpperCase() || idx + 1}</span>
              <span style={{ fontSize: 12, textAlign: "left", flex: 1 }}>{emo.label}</span>
            </button>
          ))}
          <button
            onClick={() => {
              const targetId = emotions.find((e) => e.id === selectedEmotionId)?.id ?? emotions[0]?.id ?? "";
              startEditingEmotion(targetId);
              setEmotionStudioOpen(true);
            }}
            style={{
              minWidth: 150,
              padding: "8px 10px",
              background: "#16a085",
              color: "#fff",
              border: "1px solid #0f705e",
              borderRadius: 8,
              cursor: "pointer",
              boxShadow: "0 6px 14px rgba(0,0,0,0.35)"
            }}
          >
            Emotion Studio
          </button>
        </div>
        <div
          style={{
            position: "absolute",
            top: "50%",
            right: 12,
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            zIndex: 12
          }}
        >
          {OVERLAY_EFFECTS.map((eff, idx) => (
            <button
              key={eff.id}
              onClick={() => toggleOverlay(eff)}
              disabled={isChatInputFocused}
              style={{
                minWidth: 120,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                background: overlayStates[eff.paramId] ? "#27ae60" : "rgba(0,0,0,0.6)",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: 8,
                cursor: isChatInputFocused ? "not-allowed" : "pointer",
                boxShadow: "0 6px 14px rgba(0,0,0,0.35)",
                opacity: isChatInputFocused ? 0.5 : 1
              }}
            >
              <span style={{ fontWeight: 700 }}>{idx + 1}</span>
              <span style={{ fontSize: 12 }}>{eff.label.replace(/^[0-9]+\\.\\s*/, "")}</span>
            </button>
          ))}
        </div>
        {isEmotionStudioOpen && emotionDraft && (
          <EmotionStudio
            draft={emotionDraft}
            emotions={emotions}
            onClose={() => setEmotionStudioOpen(false)}
            onSelectEmotion={startEditingEmotion}
            onChangeDraft={updateEmotionDraft}
            onChangeKeyframe={updateKeyframe}
            onAddKeyframe={addKeyframe}
            onRemoveKeyframe={removeKeyframe}
            onSave={saveEmotion}
            onPlay={playEmotionDraft}
          />
        )}
        <div ref={canvasRef} style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }} />
      </div>
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
  onCancelSetDefault
}: ControlPanelProps) {
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

type EmotionStudioProps = {
  draft: EmotionDefinition;
  emotions: EmotionDefinition[];
  onClose: () => void;
  onSelectEmotion: (id: EmotionId) => void;
  onChangeDraft: (partial: Partial<EmotionDefinition>) => void;
  onChangeKeyframe: (index: number, updater: (frame: EmotionKeyframe) => EmotionKeyframe) => void;
  onAddKeyframe: () => void;
  onRemoveKeyframe: (index: number) => void;
  onSave: () => void;
  onPlay: () => void;
};

function EmotionStudio({
  draft,
  emotions,
  onClose,
  onSelectEmotion,
  onChangeDraft,
  onChangeKeyframe,
  onAddKeyframe,
  onRemoveKeyframe,
  onSave,
  onPlay
}: EmotionStudioProps) {
  const [selectedFrame, setSelectedFrame] = useState(0);

  useEffect(() => {
    setSelectedFrame(0);
  }, [draft.id]);

  const frame = draft.keyframes[selectedFrame] ?? draft.keyframes[0];
  const frameCount = draft.keyframes.length;

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        top: 60,
        zIndex: 15,
        width: "min(360px, 92vw)",
        maxHeight: "calc(100vh - 80px)",
        overflow: "hidden",
        background: "rgba(0,0,0,0.75)",
        color: "#fff",
        borderRadius: 10,
        padding: 12,
        boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        flexDirection: "column",
        gap: 10
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong>Emotion Studio</strong>
        <select
          value={draft.id}
          onChange={(e) => onSelectEmotion(e.target.value)}
          style={{
            background: "#111",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: 6,
            padding: "4px 8px"
          }}
        >
          {emotions.map((emo) => (
            <option key={emo.id} value={emo.id}>
              {emo.label} ({emo.id})
            </option>
          ))}
          {!emotions.some((e) => e.id === draft.id) && (
            <option value={draft.id}>
              {draft.label} ({draft.id})
            </option>
          )}
        </select>
        <button
          onClick={() => onSelectEmotion("")}
          style={{
            background: "#2980b9",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 10px",
            cursor: "pointer"
          }}
        >
          New
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto", paddingRight: 4 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#bbb" }}>Emotion ID</span>
          <input
            value={draft.id}
            onChange={(e) => onChangeDraft({ id: e.target.value })}
            style={{
              background: "#111",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 6,
              padding: "6px 8px"
            }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#bbb" }}>Label</span>
          <input
            value={draft.label}
            onChange={(e) => onChangeDraft({ label: e.target.value })}
            style={{
              background: "#111",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 6,
              padding: "6px 8px"
            }}
          />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#bbb" }}>Keyframe</span>
          <select
            value={selectedFrame}
            onChange={(e) => setSelectedFrame(Number(e.target.value))}
            style={{
              background: "#111",
              color: "#fff",
              border: "1px solid #555",
              borderRadius: 6,
              padding: "4px 8px"
            }}
          >
            {draft.keyframes.map((_, idx) => (
              <option key={`${draft.id}-${idx}`} value={idx}>
                #{idx + 1}
              </option>
            ))}
          </select>
          <button
            onClick={onAddKeyframe}
            style={{
              background: "#3498db",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer"
            }}
          >
            Add
          </button>
          {frameCount > 1 && (
            <button
              onClick={() => onRemoveKeyframe(selectedFrame)}
              style={{
                background: "transparent",
                color: "#e74c3c",
                border: "1px solid #e74c3c",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer"
              }}
            >
              Remove
            </button>
          )}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "#bbb" }}>Duration (ms)</span>
          <input
            type="number"
            min={0}
            value={frame?.durationMs ?? 0}
            onChange={(e) =>
              onChangeKeyframe(selectedFrame, (kf) => ({
                ...kf,
                durationMs: Number(e.target.value)
              }))
            }
            style={{
              background: "#111",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 6,
              padding: "6px 8px"
            }}
          />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
          {EMOTION_PARAM_CONTROLS.map((field) => (
            <label
              key={field.key}
              style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}
            >
              <span style={{ color: "#bbb", display: "flex", justifyContent: "space-between" }}>
                <span>{field.label}</span>
                <span style={{ color: "#aaa" }}>{frame?.params[field.key] ?? 0}</span>
              </span>
              <input
                type="range"
                step={field.step}
                min={field.min}
                max={field.max}
                value={frame?.params[field.key] ?? 0}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  onChangeKeyframe(selectedFrame, (kf) => ({
                    ...kf,
                    params: { ...kf.params, [field.key]: value }
                  }));
                }}
                style={{ width: "100%" }}
              />
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        <button
          onClick={onPlay}
          style={{
            background: "#9b59b6",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 12px",
            cursor: "pointer",
            flex: 1
          }}
        >
          Preview
        </button>
        <button
          onClick={onSave}
          style={{
            background: "#2ecc71",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 12px",
            cursor: "pointer",
            flex: 1
          }}
        >
          Save
        </button>
        <button
          onClick={onClose}
          style={{
            background: "#e74c3c",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 12px",
            cursor: "pointer",
            flex: 1
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

type ChatPanelProps = {
  sessions: ChatSession[];
  activeSession?: ChatSession;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  input: string;
  onChangeInput: (value: string) => void;
  onSend: () => void;
  isSending: boolean;
  error: string | null;
  isTyping: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onFocusInput: () => void;
  onBlurInput: () => void;
};

function ChatPanel({
  sessions,
  activeSession,
  onSelectSession,
  onNewSession,
  input,
  onChangeInput,
  onSend,
  isSending,
  error,
  isTyping,
  isCollapsed,
  onToggleCollapse,
  onFocusInput,
  onBlurInput
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div
      style={{
        position: "relative",
        flex: isCollapsed ? "0 0 64px" : "3 3 0",
        minWidth: isCollapsed ? 64 : 320,
        maxWidth: isCollapsed ? 64 : undefined,
        height: "100vh",
        borderRight: "1px solid #333",
        display: "flex",
        flexDirection: "column",
        background: "#0d0f12",
        color: "#fff",
        transition: "flex 0.25s ease, max-width 0.25s ease, transform 0.25s ease",
        overflow: "hidden",
        transform: "translateX(0)"
      }}
    >

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          // opacity: isCollapsed ? 0 : 1,
          // pointerEvents: isCollapsed ? "none" : "auto",
          transition: "opacity 0.2s ease"
        }}
      >
        <div
          style={{
            padding: "10px 54px 10px 10px",
            borderBottom: "1px solid #222",
            display: "flex",
            gap: 10,
            height: "60px",
            alignItems: "center"
          }}
        >
          <button
            onClick={onNewSession}
            style={{
              color: "#fff",
              borderRadius: 10,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 42,
              height: 42,
              border: "1px solid #222",
              background: "#111"
            }}
            title="New chat"
          >
            <span style={{ fontSize: 14 }}>＋</span>
          </button>
          <div
            style={{
              flex: 1,
              maxHeight: 80,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 6
            }}
          >
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: activeSession?.id === s.id ? "#1c2733" : "#111",
                  border: activeSession?.id === s.id ? "1px solid #1f8ef1" : "1px solid #222",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13 }}>{s.title || s.id}</span>
                <span style={{ fontSize: 11, color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.messages[s.messages.length - 1]?.content ?? ""}
                </span>
              </div>
            ))}
          </div>

          <button
        onClick={onToggleCollapse}
        title={isCollapsed ? "Mở chat" : "Thu gọn chat"}
        style={{
          position: "absolute",
          // top: 10,
          right: 10,
          width: 42,
          height: 42,
          borderRadius: 10,
          border: "none",
          background: "#0d0f12",
          color: "#9b59b6",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2
        }}
      >
        {isCollapsed ? "→" : "←"}
      </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {activeSession?.messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background: m.role === "user" ? "#2c3e50" : "#1f2a38",
                borderRadius: 10,
                padding: "8px 10px",
                boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
                border: "1px solid #1b2735"
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                {m.role === "user" ? "You" : "Assistant"}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          ))}
          {isTyping && (
            <div
              style={{
                alignSelf: "flex-start",
                background: "#1f2a38",
                color: "#fff",
                borderRadius: 10,
                padding: "8px 10px",
                border: "1px solid #1b2735",
                boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
                display: "inline-flex",
                gap: 6,
                alignItems: "center"
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7 }}>Estia</span>
              <span style={{ display: "flex", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9b59b6", animation: "typingDot 1s infinite" }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9b59b6", animation: "typingDot 1s infinite 0.2s" }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#9b59b6", animation: "typingDot 1s infinite 0.4s" }} />
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        {error && (
          <div style={{ color: "#e74c3c", padding: "4px 10px", fontSize: 12 }}>{error}</div>
        )}
        <div
          style={{
            borderTop: "1px solid #222",
            padding: "10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: isCollapsed ? 0 : 1,

          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              background: "#111",
              border: "1px solid #333",
              borderRadius: 24,
              padding: "6px 6px 6px 12px",
              gap: 6
            }}
          >
            <input
              value={input}
              onChange={(e) => onChangeInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={onFocusInput}
              onBlur={onBlurInput}
              placeholder="Send a message..."
              style={{
                flex: 1,
                background: "transparent",
                color: "#fff",
                border: "none",
                outline: "none",
                padding: "8px 0"
              }}
            />
            <button
              onClick={onSend}
              disabled={isSending}
              style={{
                background: "#9b59b6",
                color: "#fff",
                border: "none",
                borderRadius: 20,
                width: 38,
                height: 38,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                opacity: isSending ? 0.7 : 1,
                justifyContent: "center"
              }}
            >
              →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
