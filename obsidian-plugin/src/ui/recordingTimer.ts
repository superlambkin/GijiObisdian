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

export class RecordingTimer {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
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

  start(): void {
    if (this.isRunning()) return;
    this.startTime = this.deps.now();
    this.el.setText("🎙️ 00:00");
    this.el.show();
    this.intervalId = this.deps.setInterval(() => {
      this.el.setText(`🎙️ ${formatElapsed(this.deps.now() - this.startTime)}`);
    }, 1000);
  }

  stop(): void {
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.el.hide();
  }

  setTranscribing(): void {
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.el.setText("📝 文字起こし中…");
    this.el.show();
  }

  setSummarizing(): void {
    if (this.intervalId !== null) {
      this.deps.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.el.setText("🤖 要約生成中…");
    this.el.show();
  }
}
