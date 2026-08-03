import { Notice, Plugin } from "obsidian";
import { GijiSettings } from "../settings";
import { SegmentRecorder } from "../audio/recorder";

const BTN_MARK = "data-giji-btn";
const TOOLBAR_SELECTOR = ".claudian-input-toolbar";
const TEXTAREA_SELECTOR = ".claudian-textarea";
const INPUT_CONTAINER_SELECTOR = ".claudian-input-container";

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

function makeButton(plugin: Plugin, settings: GijiSettings): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.classList.add("giji-record-btn", "claudian-action-btn");
  btn.setAttribute("aria-label", "录音");
  btn.setAttribute(BTN_MARK, "true");
  btn.textContent = "🎙️";

  const state: ButtonState = {
    recorder: new SegmentRecorder(plugin.app),
  };

  let busy = false;

  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      if (state.recorder.isRecording()) {
        let text: string | null = null;
        try {
          text = await state.recorder.stop(settings);
        } catch {
          // Recorder already surfaces Notice; reset UI below.
        }
        btn.textContent = "🎙️";
        btn.classList.remove("giji-recording");
        state.recorder = new SegmentRecorder(plugin.app);
        if (!text) return;

        const ta = findTextarea(btn);
        if (!ta) {
          new Notice("未找到 Claudian 输入框");
          console.warn("[giji] no Claudian textarea found for toolbar", btn.closest(TOOLBAR_SELECTOR));
          return;
        }
        insertTextIntoElement(ta, text);
      } else {
        try {
          const started = await state.recorder.start(settings);
          if (started) {
            btn.textContent = "■";
            btn.classList.add("giji-recording");
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

function injectToolbar(plugin: Plugin, settings: GijiSettings, toolbar: HTMLElement) {
  if (toolbar.querySelector(`[${BTN_MARK}]`)) return;
  const btn = makeButton(plugin, settings);
  toolbar.appendChild(btn);
}

export function setupClaudianButton(plugin: Plugin, settings: GijiSettings): () => void {
  function scan() {
    const toolbars = document.querySelectorAll(TOOLBAR_SELECTOR);
    for (let i = 0; i < toolbars.length; i++) {
      injectToolbar(plugin, settings, toolbars[i] as HTMLElement);
    }
  }

  scan();

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

  return () => {
    observer.disconnect();
    document.querySelectorAll(`[${BTN_MARK}]`).forEach((btn) => btn.remove());
  };
}
