import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../settings";
import {
  transcribeAndSaveAudioFile,
  transcribeAndSaveAudioFiles,
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
    assert.ok(input.accept.includes("audio/wav"));
    assert.ok(input.accept.includes("audio/mp4"));
    assert.deepEqual(order, ["attach", "click", "detach"]); // body 接続→click→除去 の順
  } finally {
    delete (globalThis as any).document;
  }
});

test("transcribeAndSaveAudioFiles merges successful files in lastModified order", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  const files = [
    makeFile({ name: "b.m4a", lastModified: new Date("2026-08-19T14:40:00").getTime() }),
    makeFile({ name: "a.m4a", lastModified: new Date("2026-08-19T13:27:00").getTime() }),
    makeFile({ name: "c.m4a", lastModified: new Date("2026-08-19T15:46:00").getTime() }),
  ];

  const result = await transcribeAndSaveAudioFiles(app, settings, files, {
    validate: async () => ({ ok: true, format: "m4a" }),
    convert: async () => new ArrayBuffer(100),
    transcribe: async () => "本文",
    concurrency: 1,
  });

  assert.equal(created.length, 1);
  const content = created[0].content;
  assert.ok(content.indexOf("a.m4a") < content.indexOf("b.m4a"));
  assert.ok(content.indexOf("b.m4a") < content.indexOf("c.m4a"));
  assert.equal(result.failed.length, 0);
});

test("transcribeAndSaveAudioFiles records invalid files and creates no note when all fail", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  const files = [makeFile({ name: "bad1.mp3" }), makeFile({ name: "bad2.mp3" })];

  const result = await transcribeAndSaveAudioFiles(app, settings, files, {
    validate: async () => ({ ok: false, error: "unsupported" }),
    concurrency: 1,
  });

  assert.equal(created.length, 0);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed.join("\n"), /bad1\.mp3/);
});

test("transcribeAndSaveAudioFiles includes failure table for partial success", async () => {
  const { app, created } = makeVault();
  const settings = { ...DEFAULT_SETTINGS, transcriptSaveDir: "議事録" };
  const files = [makeFile({ name: "good.mp3" }), makeFile({ name: "bad.m4a" })];

  await transcribeAndSaveAudioFiles(app, settings, files, {
    validate: async (file) => file.name === "bad.m4a"
      ? { ok: false, error: "invalid format" }
      : { ok: true, format: "mp3" },
    convert: async () => new ArrayBuffer(100),
    transcribe: async () => "ok",
    concurrency: 1,
  });

  assert.equal(created.length, 1);
  assert.match(created[0].content, /一部ファイルの文字起こしに失敗/);
  assert.match(created[0].content, /bad\.m4a/);
});
