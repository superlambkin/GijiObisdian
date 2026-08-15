import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";
import {
  transcribeAndSaveAudioFile,
  openRecordingFilePicker,
  AudioFileLike,
} from "../commands/transcribeFile";

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
  assert.match(
    created[0].content,
    /\| 🎙️ 録音ファイル \| \[🎙️ 録音を再生\]\(file:\/\/\/C:\/Users\/me\/Desktop\/meeting\.mp3\)/
  );
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
  assert.ok(
    created[0].path.includes("録音_2026年08月15日09時30分"),
    `unexpected path: ${created[0].path}`
  );
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

test("openRecordingFilePicker attaches input to body, clicks, then detaches", () => {
  const order: string[] = [];
  let input: any = null;
  (globalThis as any).document = {
    body: {
      appendChild(el: any) {
        order.push("attach");
        assert.equal(el, input);
      },
      removeChild(el: any) {
        order.push("detach");
        assert.equal(el, input);
      },
    },
    createElement(tag: string) {
      assert.equal(tag, "input");
      input = {
        type: "",
        accept: "",
        click() {
          order.push("click");
        },
      };
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
    assert.deepEqual(order, ["attach", "click", "detach"]); // body 接続→click→除去 の順
  } finally {
    delete (globalThis as any).document;
  }
});
