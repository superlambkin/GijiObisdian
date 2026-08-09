export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export interface RecordingTimerDeps {
  setInterval?: (handler: () => void, timeout?: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
}

type TimerMode = "recording" | "summarizing" | null;

export class RecordingTimer {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private mode: TimerMode = null;
  private deps: Required<Pick<RecordingTimerDeps, "setInterval" | "clearInterval" | "now">>;

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

  private clearTimer(): void {
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private startTicking(mode: Exclude<TimerMode, null>, label: string): void {
    this.clearTimer();
    this.mode = mode;
    this.startTime = this.deps.now();
    this.el.setText(`${label} 00:00`);
    this.el.show();
    this.intervalId = this.deps.setInterval(() => {
      this.el.setText(`${label} ${formatElapsed(this.deps.now() - this.startTime)}`);
    }, 1000);
  }

  start(): void {
    if (this.mode === "recording") return; // 録音中の二重開始は無視
    // 要約生成中に新規録音が始まった場合は録音表示へ切り替える
    this.startTicking("recording", "🎙️");
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

  setSummarizing(): void {
    // 要約生成の経過時間を表示（LLM レイテンシ調査の観測点でもある）
    this.startTicking("summarizing", "🤖 要約生成中…");
  }
}
