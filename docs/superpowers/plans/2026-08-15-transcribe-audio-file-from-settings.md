# 設定画面から録音ファイルを開いて文字起こし（転写MD保存）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定画面 **② 📝 文字起こしタブ** に「📂 録音ファイルを開いて文字起こし」ボタンを追加し、選択した録音ファイルを現在の STT 設定で転写して **転写 MD として自動保存** する。

**Architecture:** 純粋ロジック `transcribeAndSaveAudioFile()`（新規 `src/commands/transcribeFile.ts`）を新設し、既存の `transcribeAudio` / `saveTranscriptToFile` / `buildMp3Links` を再利用する。DOM ラッパー `openRecordingFilePicker()` がファイル選択ダイアログを開き、`settings.ts` の `renderTranscriptTab()` がそのボタンを描画する。転写→MD保存のみ（議事録・LLM 要約は行わない）。

**Tech Stack:** TypeScript / Obsidian Plugin API / `node:test`（tsx・`setup.cjs` で obsidian をスタブ）

**Spec:** `docs/superpowers/specs/2026-08-15-transcribe-audio-file-from-settings-design.md`

## Global Constraints

- テスト実行: `obsidian-plugin/` 配下で `npm test`（`tsx --require ./src/__tests__/setup.cjs --test "src/__tests__/**/*.test.ts"`）
- 追記は**常に新規 MD 作成**（`{ ...settings, appendRecordEnabled: false }` のクローンを `saveTranscriptToFile` に渡す。既存関数のシグネチャは変更しない）
- 時刻基準はファイルの **`lastModified`**（フォールバック: 現在時刻）
- `autoSaveTranscript` は**従わない**（手動明示操作のため常に保存）
- 再生時間は `new Audio(URL.createObjectURL(blob))` で取得（失敗時 `undefined`）
- 議事録（LLM要約）生成は**しない**
- ファイル形式: `audio/*,.wav,.mp3,.m4a,.flac,.ogg`
- `charCount` は `text.trim().length`（`renderTranscriptNote` の文字数欄と同一定義）

---

### Task 1: 純粋ロジック `transcribeAndSaveAudioFile()`

**Files:**
- Create: `obsidian-plugin/src/commands/transcribeFile.ts`
- Test: `obsidian-plugin/src/__tests__/transcribeFile.test.ts`

**Interfaces:**
- Consumes: `transcribeAudio(wav: ArrayBuffer, settings, fetchImpl?) => Promise<string>`（`./importAudio`）、`saveTranscriptToFile(app, settings, text, durationSec?, now?, mp3Links?, sttMs?) => Promise<{path, appended}>`（`../notes/saver`）、`buildMp3Links(audioPaths: string[]) => string`（`../notes/mp3Ref`）
- Produces: `AudioFileLike` 型、`TranscribeFileDeps` 型、`transcribeAndSaveAudioFile(app, settings, file, deps?) => Promise<{ path: string; charCount: number }>`、`defaultGetDurationSec`（内部ヘルパー）

- [ ] **Step 1: Write the failing test**

Create `obsidian-plugin/src/__tests__/transcribeFile.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";
import { transcribeAndSaveAudioFile, AudioFileLike } from "../commands/transcribeFile";

function makeVault() {
  const files = new Map<string, boolean>();
  const created: Array<{ path: string; content: string }> = [];
  return {
    created,
    files,
    app: {
      vault: {
        adapter: {
          exists: async (p: string) => files.get(p) ?? false,
          list: async () => ({ files: [], folders: [] }),
          read: async () => "",
          write: async () => {},
        },
        createFolder: async (dir: string) => files.set(dir, true),
        create: async (path: string, content: string) => {
          created.push({ path, content });
          files.set(path, true);
        },
      },
    } as any,
  };
}

const LAST_MODIFIED = new Date("2026-08-15T09:30:00").getTime();

function makeFile(overrides: Partial<AudioFileLike> = {}): AudioFileLike {
  return {
    name: "meeting.mp3",
    path: "C:\\Users\\me\\Desktop\\meeting.mp3",
    lastModified: LAST_MODIFIED,
    arrayBuffer: async () => new ArrayBuffer(8),
    ...overrides,
  };
}

test("transcribeAndSaveAudioFile creates a new transcript MD at expected path", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  const file = makeFile();
  const result = await transcribeAndSaveAudioFile(app, settings, file, {
    transcribe: async () => "こんにちは世界",
    getDurationSec: async () => 60,
  });
  assert.equal(result.charCount, 7); // "こんにちは世界" = 7 文字
  assert.equal(created.length, 1);
  assert.ok(created[0].path.startsWith("議事録/録音_2026年08月15日"));
  assert.match(created[0].path, /\.md$/);
});

test("transcribeAndSaveAudioFile includes 録音ファイル row when file.path present", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  await transcribeAndSaveAudioFile(app, settings, makeFile(), {
    transcribe: async () => "本文",
    getDurationSec: async () => 60,
  });
  assert.equal(created.length, 1);
  assert.match(created[0].content, /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]\(file:\/\/\/C:\/Users\/me\/Desktop\/meeting\.mp3\)/);
});

test("transcribeAndSaveAudioFile omits 録音ファイル row when file.path absent", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  await transcribeAndSaveAudioFile(app, settings, makeFile({ path: undefined }), {
    transcribe: async () => "本文",
    getDurationSec: async () => 60,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].content.includes("🎙️ 録音ファイル"), false);
});

test("transcribeAndSaveAudioFile uses file.lastModified for filename and 録音日時", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  // lastModified = 2026-08-15T09:30:00
  await transcribeAndSaveAudioFile(app, settings, makeFile(), {
    transcribe: async () => "本文",
    getDurationSec: async () => 60,
  });
  assert.equal(created.length, 1);
  assert.ok(created[0].path.includes("録音_2026年08月15日09時30分"), `unexpected path: ${created[0].path}`);
});

test("transcribeAndSaveAudioFile never appends even when appendRecordEnabled=true", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録", appendRecordEnabled: true };
  await transcribeAndSaveAudioFile(app, settings, makeFile(), {
    transcribe: async () => "本文",
    getDurationSec: async () => 60,
  });
  assert.equal(created.length, 1); // 追記（read/write）ではなく新規 create
});

test("transcribeAndSaveAudioFile propagates STT errors", async () => {
  const { app } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  await assert.rejects(
    () =>
      transcribeAndSaveAudioFile(app, settings, makeFile(), {
        transcribe: async () => {
          throw new Error("STT API error");
        },
        getDurationSec: async () => 60,
      }),
    /STT API error/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd obsidian-plugin && npm test -- src/__tests__/transcribeFile.test.ts`
Expected: FAIL — "Cannot find module '../commands/transcribeFile'"

- [ ] **Step 3: Write minimal implementation**

Create `obsidian-plugin/src/commands/transcribeFile.ts`:

```ts
import { App } from "obsidian";
import { GijiSettings } from "../settings";
import { transcribeAudio } from "./importAudio";
import { saveTranscriptToFile } from "../notes/saver";
import { buildMp3Links } from "../notes/mp3Ref";

/** File の互換インターフェース（テスト容易性） */
export interface AudioFileLike {
  name: string;
  path?: string;
  lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** テスト注入用依存 */
export interface TranscribeFileDeps {
  transcribe?: (buf: ArrayBuffer, settings: GijiSettings) => Promise<string>;
  getDurationSec?: (file: AudioFileLike) => Promise<number | undefined>;
}

/** 再生時間を取得（失敗時は undefined）。既定実装。 */
async function defaultGetDurationSec(file: AudioFileLike): Promise<number | undefined> {
  try {
    const buf = await file.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf]));
    const audio = new Audio(url);
    const duration = await new Promise<number | undefined>((resolve) => {
      audio.addEventListener("loadedmetadata", () => resolve(isFinite(audio.duration) ? audio.duration : undefined), { once: true });
      audio.addEventListener("error", () => resolve(undefined), { once: true });
    });
    URL.revokeObjectURL(url);
    return duration;
  } catch {
    return undefined;
  }
}

/**
 * 選択した録音ファイルを現在の STT 設定で転写し、転写 MD として自動保存する。
 * - 追記は行わず常に新規 MD 作成（appendRecordEnabled は無視）
 * - 時刻基準はファイルの lastModified（フォールバック: 現在時刻）
 * - 議事録（LLM要約）は生成しない
 */
export async function transcribeAndSaveAudioFile(
  app: App,
  settings: GijiSettings,
  file: AudioFileLike,
  deps: TranscribeFileDeps = {}
): Promise<{ path: string; charCount: number }> {
  const transcribe = deps.transcribe ?? transcribeAudio;
  const getDurationSec = deps.getDurationSec ?? defaultGetDurationSec;

  const buf = await file.arrayBuffer();
  const sttStart = Date.now();
  const text = await transcribe(buf, settings);
  const sttMs = Date.now() - sttStart;

  const mp3Links = file.path ? buildMp3Links([file.path]) : "";
  const durationSec = await getDurationSec(file);
  const now = new Date(file.lastModified || Date.now());

  // 追記無効化：1ファイル=1転写MD の一対一対応を保証
  const settingsClone = { ...settings, appendRecordEnabled: false };
  const saved = await saveTranscriptToFile(app, settingsClone, text, durationSec, now, mp3Links, sttMs);

  return { path: saved.path, charCount: text.trim().length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd obsidian-plugin && npm test -- src/__tests__/transcribeFile.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add obsidian-plugin/src/commands/transcribeFile.ts obsidian-plugin/src/__tests__/transcribeFile.test.ts
git commit -m "feat(plugin): add transcribeAndSaveAudioFile pure logic for file picker"
```

---

### Task 2: DOM ラッパー `openRecordingFilePicker()`

**Files:**
- Modify: `obsidian-plugin/src/commands/transcribeFile.ts`（末尾に追加）
- Test: `obsidian-plugin/src/__tests__/transcribeFile.test.ts`（末尾に追加）

**Interfaces:**
- Consumes: `transcribeAndSaveAudioFile(app, settings, file)`（Task 1）、`App` / `TFile`（obsidian）
- Produces: `openRecordingFilePicker(app: App, settings: GijiSettings): void`

- [ ] **Step 1: Write the failing test**

Append to `obsidian-plugin/src/__tests__/transcribeFile.test.ts`:

```ts
import { openRecordingFilePicker } from "../commands/transcribeFile";

test("openRecordingFilePicker creates an audio file input and clicks it", () => {
  let clicked = false;
  let input: any = null;
  (globalThis as any).document = {
    createElement(tag: string) {
      assert.equal(tag, "input");
      input = { type: "", accept: "", click() { clicked = true; } };
      return input;
    },
  };
  try {
    const app = {
      vault: { getAbstractFileByPath: () => null },
      workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    } as any;
    openRecordingFilePicker(app, DEFAULT_SETTINGS);
    assert.equal(input.type, "file");
    assert.ok(input.accept.includes(".mp3"));
    assert.ok(input.accept.includes("audio/*"));
    assert.equal(clicked, true);
  } finally {
    delete (globalThis as any).document;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd obsidian-plugin && npm test -- src/__tests__/transcribeFile.test.ts`
Expected: FAIL — "openRecordingFilePicker is not a function"

- [ ] **Step 3: Write minimal implementation**

First, update the import line at the top of `obsidian-plugin/src/commands/transcribeFile.ts` from `import { App } from "obsidian";` to:

```ts
import { App, Notice, TFile } from "obsidian";
```

Then append to the bottom of `obsidian-plugin/src/commands/transcribeFile.ts`:

```ts
/**
 * ファイル選択ダイアログを開く DOM ラッパー（settings.ts から呼ぶ）。
 * 選択後は transcribeAndSaveAudioFile で転写→MD保存し、作成 MD をエディタで開く。
 */
export function openRecordingFilePicker(app: App, settings: GijiSettings): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*,.wav,.mp3,.m4a,.flac,.ogg";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const { path } = await transcribeAndSaveAudioFile(app, settings, file as AudioFileLike);
      new Notice(`✅ 転写を保存しました: ${path}`);
      const tfile = app.vault.getAbstractFileByPath(path);
      if (tfile instanceof TFile) {
        await app.workspace.getLeaf(false).openFile(tfile);
      }
    } catch (err: any) {
      new Notice(`❌ 転写に失敗しました: ${err?.message ?? err}`);
    }
  };
  input.click();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd obsidian-plugin && npm test -- src/__tests__/transcribeFile.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add obsidian-plugin/src/commands/transcribeFile.ts obsidian-plugin/src/__tests__/transcribeFile.test.ts
git commit -m "feat(plugin): add openRecordingFilePicker DOM wrapper"
```

---

### Task 3: 設定画面 ② 文字起こしタブにボタン追加

**Files:**
- Modify: `obsidian-plugin/src/settings.ts`（import + `renderTranscriptTab()` 内、`🔌 接続テスト` Setting の直後）
- Test: `obsidian-plugin/src/__tests__/settings.test.ts`（末尾に追加）

**Interfaces:**
- Consumes: `openRecordingFilePicker(app: App, settings: GijiSettings): void`（`./commands/transcribeFile`）
- Produces: なし（renderTranscriptTab 内にボタン描画）

- [ ] **Step 1: Write the failing test**

Append to `obsidian-plugin/src/__tests__/settings.test.ts`:

```ts
test("renderTranscriptTab adds 録音ファイルを開いて文字起こし button after 接続テスト", () => {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
    manifest: { version: "0.0.0", dir: "" },
  };
  const tab = new GijiSettingsTab({} as any, plugin);
  const content: any = {};
  tab.renderTranscriptTab(content);
  const texts = (content._buttons ?? []).map((b: any) => b._text);
  const idx = texts.indexOf("テスト開始");
  const btnIdx = texts.indexOf("📂 録音ファイルを開いて文字起こし");
  assert.ok(idx !== -1, "接続テスト button should exist");
  assert.ok(btnIdx !== -1, "録音ファイルを開いて文字起こし button should exist");
  assert.ok(btnIdx > idx, "録音ファイルを開いて文字起こし should be after テスト開始");
  const btn = content._buttons[btnIdx];
  assert.equal(typeof btn._onClick, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd obsidian-plugin && npm test -- src/__tests__/settings.test.ts`
Expected: FAIL — "録音ファイルを開いて文字起こし button should exist"

- [ ] **Step 3: Write minimal implementation**

Modify `obsidian-plugin/src/settings.ts`:

1. Add import at top of file (with the other imports):

```ts
import { openRecordingFilePicker } from "./commands/transcribeFile";
```

2. Insert this block **immediately after** the `🔌 接続テスト` Setting block (after its closing `);` at what was line 600), inside `renderTranscriptTab()`:

```ts
    new Setting(content)
      .setName("📂 録音ファイルを開いて文字起こし")
      .setDesc("PC 上の録音ファイル（wav / mp3 / m4a / flac / ogg）を選び、現在の ② 文字起こし設定で転写して転写 MD を自動保存します")
      .addButton((btn) =>
        btn
          .setButtonText("📂 録音ファイルを開いて文字起こし")
          .setCta()
          .onClick(() => {
            void openRecordingFilePicker(this.app, s);
          })
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd obsidian-plugin && npm test -- src/__tests__/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite (regression)**

Run: `cd obsidian-plugin && npm test`
Expected: PASS (全件・既存テストに退行なし)

- [ ] **Step 6: Commit**

```bash
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "feat(plugin): add 録音ファイルを開いて文字起こし button to transcript settings tab"
```
