import { Notice, Plugin } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder } from "../audio/recorder";
import { isWhisperLocalUp } from "../whisperLocalLauncher";
import { saveTranscriptToFile } from "../notes/saver";
import { buildMp3Links } from "../notes/mp3Ref";
import { appendToClaudianInput } from "./claudianApi";
import { runAutoSummarize } from "../commands/autoSummarize";
import { RecordingTimer, llmModelLabel } from "./recordingTimer";

const BTN_MARK = "data-giji-btn";
const TOOLBAR_SELECTOR = ".claudian-input-toolbar";
const TEXTAREA_SELECTOR = ".claudian-textarea";
const INPUT_CONTAINER_SELECTOR = ".claudian-input-container";

/** 選択中 STT プロバイダの文字起こし用モデル名（録音ボタンのツールチップ表示用） */
export function sttModelLabel(settings: GijiSettings): string {
  switch (settings.sttProvider) {
    case "whisper-local":
      return "Whisper";
    case "mywhisper":
      return "MyWhisper";
    case "openai":
      return "OpenAI";
    case "groq":
      return "Groq";
    case "google":
      return "Google";
    default:
      return settings.sttProvider;
  }
}

/**
 * 録音ボタンのホバーツールチップに文字起こし用モデル名を反映する。
 * ローカル STT 選択時はサーバ未起動なら赤背景にもする（クラウド時は通常表示）。
 */
export async function refreshSttDownState(settings: GijiSettings): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(".giji-record-btn");
  if (!btn) return;
  const model = `文字起こし: ${sttModelLabel(settings)}`;
  btn.setAttribute("aria-label", model);
  btn.setAttribute("title", model);
  if (settings.sttProvider !== "whisper-local") {
    btn.classList.remove("giji-stt-down");
    return;
  }
  const up = await isWhisperLocalUp(settings);
  btn.classList.toggle("giji-stt-down", !up);
}

interface ButtonState {
  recorder: SegmentRecorder;
}

function findTextarea(toolbar: HTMLElement): HTMLElement | null {
  let container = toolbar.closest(INPUT_CONTAINER_SELECTOR) as HTMLElement | null;
  if (container) {
    const ta = container.querySelector(TEXTAREA_SELECTOR) as HTMLElement | null;
    if (ta) return ta;
  }
  // Fallback: traverse up through ancestors and search siblings/self.
  let el: HTMLElement | null = toolbar;
  while (el) {
    const ta = el.querySelector(TEXTAREA_SELECTOR) as HTMLElement | null;
    if (ta) return ta;
    el = el.parentElement;
  }
  return document.querySelector(TEXTAREA_SELECTOR) as HTMLElement | null;
}

function insertTextIntoElement(el: HTMLElement, text: string) {
  if (!text) return;

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const spacer = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    el.value = before + spacer + text + after;
    const pos = start + spacer.length + text.length;
    el.selectionStart = el.selectionEnd = pos;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // contenteditable or other element
  if ((el as any).isContentEditable) {
    el.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      // Guard against writing into a different focused element.
      if (!el.contains(selection.anchorNode)) {
        selection.selectAllChildren(el);
        selection.collapseToEnd();
      }
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const spacer = range.startOffset > 0 ? document.createTextNode("\n") : null;
      if (spacer) range.insertNode(spacer);
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      const spacer = el.lastChild ? document.createTextNode("\n") : null;
      if (spacer) el.appendChild(spacer);
      el.appendChild(document.createTextNode(text));
    }
  } else {
    // Last resort: try execCommand for framework compatibility.
    try {
      el.focus();
      document.execCommand("insertText", false, text);
    } catch {
      // If all else fails, append raw text.
      el.appendChild(document.createTextNode(text));
    }
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * 停止後の後処理: 転写保存（任意）+ 議事録自動生成。
 * コマンドフロー（recordSegment.ts::stopSegment）と同等の要約自動生成を
 * ツールバー 🎙️ ボタンにも配線する。autoSummarizeImpl はテスト用に注入可能。
 */
export interface SaveAndSummarizeOptions {
  startTime?: Date;
  audioPaths?: string[];
  sttMs?: number;
  autoSummarizeImpl?: typeof runAutoSummarize;
}

export async function saveTranscriptAndAutoSummarize(
  plugin: Plugin,
  settings: GijiSettings,
  text: string,
  durationSec: number | undefined,
  opts: SaveAndSummarizeOptions = {},
): Promise<void> {
  const mp3Links = buildMp3Links(opts.audioPaths ?? []);
  const sttSec = typeof opts.sttMs === "number" ? (opts.sttMs / 1000).toFixed(1) : null;
  const timeSuffix = sttSec ? `（处理时间: ${sttSec} 秒）` : "";
  if (settings.autoSaveTranscript) {
    try {
      const saved = await saveTranscriptToFile(
        plugin.app,
        settings,
        text,
        durationSec,
        opts.startTime ?? new Date(),
        mp3Links,
        opts.sttMs
      );
      new Notice(
        saved.appended
          ? `📄 已追记到议事录: ${saved.path}${timeSuffix}`
          : `📄 转写已保存: ${saved.path}${timeSuffix}`
      );
    } catch (err: any) {
      new Notice(`保存转写失败: ${err?.message ?? err}`);
    }
  }
  const impl = opts.autoSummarizeImpl ?? runAutoSummarize;
  await impl(text, settings, plugin.app, plugin.manifest.dir, {
    startTime: opts.startTime,
    durationSec,
    mp3Links,
    sttMs: opts.sttMs,
  });
}

function makeButton(plugin: Plugin, settings: GijiSettings, timer?: RecordingTimer): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.classList.add("giji-record-btn", "claudian-action-btn");
  btn.setAttribute("aria-label", "录音");
  btn.setAttribute(BTN_MARK, "true");
  btn.textContent = "🎙️";

  const state: ButtonState = {
    recorder: new SegmentRecorder(plugin.app, plugin.manifest.dir),
  };

  let busy = false;

  // ローカル STT サーバ未起動時は赤背景（転写不可の警告）。定期ポーリングでも更新される
  void refreshSttDownState(settings);

  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      if (state.recorder.isRecording()) {
        timer?.setTranscribing(); // 録音停止 → 文字起こし中
        let text: string | null = null;
        let durationSec: number | undefined;
        let startTime: Date | undefined;
        let audioPaths: string[] = [];
        let sttMs: number | undefined;
        try {
          const result = await state.recorder.stop(settings);
          if (result) {
            text = result.text;
            durationSec = result.durationSec;
            startTime = result.startTime;
            audioPaths = result.audioPaths ?? [];
            sttMs = result.sttMs;
          }
        } catch {
          // Recorder already surfaces Notice; reset UI below.
          timer?.stop(); // ← 例外時もタイマーを停止（status bar の詰まり防止）
        }
        btn.textContent = "🎙️";
        btn.classList.remove("giji-recording");
        state.recorder = new SegmentRecorder(plugin.app, plugin.manifest.dir);
        if (!text) {
          timer?.stop(); // 転写が空・録音なし時もタイマーを非表示に戻す
          return;
        }

        // 転写保存（任意）+ 議事録の自動生成（要約）
        timer?.setSummarizing(llmModelLabel(settings)); // 要約生成中（モデル名付き）
        try {
          await saveTranscriptAndAutoSummarize(plugin, settings, text, durationSec, {
            startTime,
            audioPaths,
            sttMs,
          });
        } finally {
          timer?.stop(); // 全処理完了で非表示
        }

        // 設定「結果を Claudian 入力欄に挿入」が OFF の場合は挿入しない。
        // claudian + 自動要約ON 時は要約プロンプトに転写全文が含まれるため重複挿入を避ける。
        const skipRawInsert =
          settings.llmProvider === "claudian" && settings.autoSummarizeEnabled;
        if (settings.insertToClaudianEnabled && !skipRawInsert) {
          // 内部 API 優先（realclaudian 自身が入力欄を解決するため頑健）。
          // 失敗時のみ DOM セレクタ方式へフォールバック。
          const inserted = await appendToClaudianInput(plugin.app, text);
          if (!inserted) {
            const ta = findTextarea(btn);
            if (!ta) {
              new Notice("未找到 Claudian 输入框");
              console.warn("[giji] no Claudian textarea found for toolbar", btn.closest(TOOLBAR_SELECTOR));
              return;
            }
            insertTextIntoElement(ta, text);
          }
        }
      } else {
        try {
          const started = await state.recorder.start(settings);
          if (started) {
            btn.textContent = "■";
            btn.classList.add("giji-recording");
            timer?.start(); // ← ここでタイマー表示
          }
        } catch {
          // Notice already shown by SegmentRecorder.
        }
      }
    } finally {
      busy = false;
      btn.disabled = false;
    }
  });

  return btn;
}

function injectToolbar(plugin: Plugin, settings: GijiSettings, toolbar: HTMLElement, timer?: RecordingTimer) {
  const hasRecord = toolbar.querySelector(".giji-record-btn");
  if (!hasRecord) {
    const recordBtn = makeButton(plugin, settings, timer);
    toolbar.appendChild(recordBtn);
  }
}

export function setupClaudianButton(
  plugin: Plugin,
  settings: GijiSettings,
  timer?: RecordingTimer,
): { cleanup: () => void; refresh: () => void } {
  let sttInterval: ReturnType<typeof setInterval> | null = null;

  function scan() {
    const toolbars = document.querySelectorAll(TOOLBAR_SELECTOR);
    for (let i = 0; i < toolbars.length; i++) {
      injectToolbar(plugin, settings, toolbars[i] as HTMLElement, timer);
    }
  }

  function refresh() {
    scan();
    // ローカル STT サーバ未起動警告の定期更新（15 秒間隔）
    if (!sttInterval) {
      void refreshSttDownState(settings).catch(() => {});
      sttInterval = setInterval(() => {
        void refreshSttDownState(settings).catch((err) =>
          console.warn("[giji] stt server status refresh failed", err)
        );
      }, 15000);
    }
  }

  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (const m of mutations) {
      if (m.type !== "childList") continue;
      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i];
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches?.(TOOLBAR_SELECTOR) || node.querySelector(TOOLBAR_SELECTOR)) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) break;
    }
    if (shouldScan) scan();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  refresh();

  return {
    refresh,
    cleanup: () => {
      if (sttInterval) {
        clearInterval(sttInterval);
        sttInterval = null;
      }
      observer.disconnect();
      document.querySelectorAll(`[${BTN_MARK}]`).forEach((btn) => btn.remove());
    },
  };
}
