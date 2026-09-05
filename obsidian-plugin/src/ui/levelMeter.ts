import type { PcLevel } from "../audio/directRecorder";

/** v0.15: メーターの計測源。mic=録音マイク / pc=スピーカー（ループバック） */
export type MeterSource = "mic" | "pc";

/**
 * v0.15: RMS をメーターバー幅（0〜100%）へ変換する。
 * dB スケール（下限 -60dB）で変換し、知覚的に自然な動きにする。
 * - rms=1（フルスケール）→ 100%
 * - rms<=0.001（-60dB 以下・無音含む）→ 0%
 */
export function rmsToWidthPercent(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-9));
  const clamped = Math.min(0, Math.max(-60, db));
  return ((clamped + 60) / 60) * 100;
}

/** v0.15: バー幅（%）から色クラスを決める。-12dB=80% / -6dB=90% を閾値にする */
export function levelColorClass(widthPercent: number): string {
  if (widthPercent >= 90) return "giji-level-red";
  if (widthPercent >= 80) return "giji-level-yellow";
  return "giji-level-green";
}

export const LEVEL_METER_CSS = `
.giji-level-meter {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
}
.giji-level-icon {
  font-size: 10px;
}
.giji-level-bar {
  width: 60px;
  height: 8px;
  background: var(--background-modifier-cover, #ccc);
  border-radius: 4px;
  overflow: hidden;
  margin: 0 4px;
}
.giji-level-fill {
  height: 100%;
  width: 0%;
  transition: width 0.1s linear;
  border-radius: 4px;
}
.giji-level-green { background: #4caf50; }
.giji-level-yellow { background: #ffb300; }
.giji-level-red { background: #e53935; }
.giji-level-unavailable { background: #999; }
`;

/** recordingStyles.injectRecordingStyles と同じガードパターンで 1 回だけ注入する */
export function injectLevelMeterStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("giji-level-meter-styles")) return;
  const style = document.createElement("style");
  style.id = "giji-level-meter-styles";
  style.textContent = LEVEL_METER_CSS;
  document.head.appendChild(style);
}

/**
 * v0.15: ステータスバーに 🎤 / 🔊 の 2 本の入力レベルバーを表示する。
 * CSS transition（0.1s linear）でアニメーションする。録音中と入力テストで共用する。
 */
export class LevelMeter {
  private root: HTMLElement;
  private fills = new Map<MeterSource, HTMLElement>();
  private unavailable = new Set<MeterSource>();

  constructor(private el: HTMLElement) {
    this.root = el.createDiv();
    this.root.className = "giji-level-meter";
    this.fills.set("mic", this.buildBar("🎤", "mic"));
    this.fills.set("pc", this.buildBar("🔊", "pc"));
    el.hide();
  }

  private buildBar(icon: string, source: MeterSource): HTMLElement {
    const iconEl = this.root.createSpan();
    iconEl.className = "giji-level-icon";
    iconEl.textContent = icon;
    const bar = this.root.createDiv();
    bar.className = "giji-level-bar";
    const fill = bar.createDiv();
    fill.className = `giji-level-fill giji-level-${source} giji-level-green`;
    fill.style.width = "0%";
    return fill;
  }

  /** レベル更新。width を書き換え、色を閾値で切替。unavailable 状態から復帰する */
  setLevel(source: MeterSource, level: PcLevel): void {
    const fill = this.fills.get(source);
    if (!fill) return;
    this.unavailable.delete(source);
    const width = rmsToWidthPercent(level.rms);
    fill.style.width = `${width.toFixed(1)}%`;
    fill.className = `giji-level-fill giji-level-${source} ${levelColorClass(width)}`;
  }

  /** レベルが取得できない源（Python 無応答等）を灰色表示にする。冪等 */
  setUnavailable(source: MeterSource): void {
    const fill = this.fills.get(source);
    if (!fill || this.unavailable.has(source)) return;
    this.unavailable.add(source);
    fill.className = `giji-level-fill giji-level-${source} giji-level-unavailable`;
  }

  show(): void {
    this.el.show();
  }

  hide(): void {
    this.el.hide();
  }

  destroy(): void {
    this.root.remove();
    this.fills.clear();
  }
}
