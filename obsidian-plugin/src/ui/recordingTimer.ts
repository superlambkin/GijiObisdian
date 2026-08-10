import type { GijiSettings } from "../settings";

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** 要約に使う LLM モデルの表示名（ステータスバー表示用） */
export function llmModelLabel(settings: GijiSettings): string {
  if (settings.llmProvider === "claudian") return "Claudian";
  return settings.llmModel || settings.llmProvider;
}

export interface RecordingTimerDeps {
  setInterval?: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
}

type TimerMode = "recording" | "summarizing" | null;

/** 要約の進捗ステージ */
export type SummarizeStage = "connecting" | "generating" | "saving";

const SUMMARIZE_LABELS: Record<SummarizeStage, string> = {
  connecting: "📡 接続中…",
  generating: "✍️ 生成中…",
  saving: "💾 保存中…",
};

export class RecordingTimer {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private mode: TimerMode = null;
  private deps: Required<Pick<RecordingTimerDeps, "setInterval" | "clearInterval" | "now">>;
  private summarizeStage: SummarizeStage = "connecting";
  private summarizeChars: number | null = null;
  private summarizeModel: string | null = null;

  constructor(private el: HTMLElement, deps: RecordingTimerDeps = {}) {
    this.el.hide();
    this.deps = {
      setInterval: deps.setInterval ?? ((handler, timeout) => setInterval(handler, timeout)),
      clearInterval: deps.clearInterval ?? ((handle) => clearInterval(handle)),
      now: deps.now ?? (() => Date.now()),
    };
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  /** 要約実行中か（二重実行防止用） */
  isSummarizing(): boolean {
    return this.mode === "summarizing";
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private summarizeLabel(): string {
    const base = SUMMARIZE_LABELS[this.summarizeStage];
    const model = this.summarizeModel ? `（${this.summarizeModel}）` : "";
    const chars =
      this.summarizeStage === "generating" && this.summarizeChars !== null
        ? ` ${this.summarizeChars.toLocaleString()}字`
        : "";
    return `${base}${model}${chars}`;
  }

  private render(): void {
    const label = this.mode === "summarizing" ? this.summarizeLabel() : "🎙️";
    this.el.setText(`${label} ${formatElapsed(this.deps.now() - this.startTime)}`);
  }

  private startTicking(mode: Exclude<TimerMode, null>): void {
    this.clearTimer();
    this.mode = mode;
    this.startTime = this.deps.now();
    this.render();
    this.el.show();
    this.intervalId = this.deps.setInterval(() => this.render(), 1000);
  }

  start(): void {
    if (this.mode === "recording") return; // 録音中の二重開始は無視
    // 要約生成中に新規録音が始まった場合は録音表示へ切り替える
    this.startTicking("recording");
  }

  stop(): void {
    this.clearTimer();
    this.mode = null;
    this.el.hide();
  }

  setTranscribing(): void {
    this.clearTimer();
    this.mode = null;
    this.el.setText("📝 文字起こし中…");
    this.el.show();
  }

  setSummarizing(model?: string): void {
    // 要約開始時は接続待ち（TTFB）から表示
    this.summarizeModel = model ?? null;
    this.summarizeStage = "connecting";
    this.summarizeChars = null;
    this.startTicking("summarizing");
  }

  /** 要約ステージを更新。summarizing モード以外では表示に反映しない */
  updateSummarizeStage(stage: SummarizeStage, receivedChars?: number): void {
    this.summarizeStage = stage;
    if (receivedChars !== undefined) this.summarizeChars = receivedChars;
    if (this.mode === "summarizing" && this.intervalId !== null) {
      this.render();
    }
  }
}
