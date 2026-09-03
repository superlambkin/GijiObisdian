import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  GijiSettingsTab,
  isLocalSttProvider,
  SETTINGS_TABS,
  clampSttConcurrency,
} from "../settings";

test("DEFAULT_SETTINGS has required fields", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "groq");
  assert.equal(DEFAULT_SETTINGS.sttLang, "auto");
  assert.equal(DEFAULT_SETTINGS.llmProvider, "claudian");
  assert.equal(DEFAULT_SETTINGS.autoSaveTranscript, true);
  assert.equal(DEFAULT_SETTINGS.transcriptSaveDir, "議事録");
  assert.equal(DEFAULT_SETTINGS.outputDir, "議事録");
  assert.equal(
    DEFAULT_SETTINGS.transcriptFileNameTemplate,
    "録音_{{year}}年{{month}}月{{day}}日{{hour}}時{{minute}}分"
  );
  assert.ok(DEFAULT_SETTINGS.fileNameTemplate.startsWith("議事録_"));
  assert.ok(DEFAULT_SETTINGS.transcriptFileNameTemplate.startsWith("録音_"));
});

/* ---------------- v0.13.2: 設定画面にバージョン情報パネル ---------------- */

import { buildVersionInfoText } from "../settings";

test("buildVersionInfoText: 引数のバージョンを 'v' プレフィックス付きで返す", () => {
  assert.equal(buildVersionInfoText("0.13.1"), "v0.13.1");
});

test("buildVersionInfoText: undefined/空文字は 'v0.0.0' にフォールバック", () => {
  assert.equal(buildVersionInfoText(undefined), "v0.0.0");
  assert.equal(buildVersionInfoText(""), "v0.0.0");
});

test("buildVersionInfoText: 既に 'v' 始まりの場合は二重付与しない", () => {
  assert.equal(buildVersionInfoText("v1.2.3"), "v1.2.3");
});

test("DEFAULT_SETTINGS includes whisper-local fields", () => {
  assert.equal(DEFAULT_SETTINGS.sttBaseUrl, "http://127.0.0.1:9000/v1");
  assert.equal(DEFAULT_SETTINGS.sttServerDir, "");
});

test("DEFAULT_SETTINGS has recording save dir + file name template", () => {
  assert.ok(DEFAULT_SETTINGS.recordingSaveDir.includes("GijiObsidian"));
  assert.ok(DEFAULT_SETTINGS.recordingFileNameTemplate.includes("{{year}}"));
  assert.ok(DEFAULT_SETTINGS.recordingFileNameTemplate.includes("{{second}}"));
  assert.equal(DEFAULT_SETTINGS.audioSource, "mix");
});

test("DEFAULT_SETTINGS has device id fields (empty by default)", () => {
  assert.equal(DEFAULT_SETTINGS.directMicDeviceId, "");
  assert.equal(DEFAULT_SETTINGS.directSpeakerDeviceId, "");
});

test("DEFAULT_SETTINGS has new feature flags", () => {
  assert.equal(DEFAULT_SETTINGS.insertToClaudianEnabled, true);
  assert.equal(DEFAULT_SETTINGS.minutesTemplateSource, "vault");
  assert.equal(DEFAULT_SETTINGS.minutesTemplateVaultPath, "00_Vault管理/議事録テンプレート.md");
  assert.equal(DEFAULT_SETTINGS.minutesTemplateFile, "議事録テンプレート.md");
  assert.equal(DEFAULT_SETTINGS.emailSummaryEnabled, false);
});

test("DEFAULT_SETTINGS has simplified LLM defaults", () => {
  assert.equal(DEFAULT_SETTINGS.llmProvider, "claudian");
  assert.equal(DEFAULT_SETTINGS.llmMaxTokens, 32000);
  assert.equal(DEFAULT_SETTINGS.llmAdvancedOpen, false);
  assert.equal(DEFAULT_SETTINGS.llmApiFormatOverride, false);
  assert.equal(DEFAULT_SETTINGS.llmThinkingEnabled, false);
});

// 設定画面の 4 タブ構成（録音/文字起こし/要約/その他）
test("SETTINGS_TABS: 4 つのタブ（録音/文字起こし/要約/その他）を持つ", () => {
  assert.deepEqual(
    SETTINGS_TABS.map((t) => t.id),
    ["recording", "transcript", "summary", "other"]
  );
  for (const t of SETTINGS_TABS) {
    assert.ok(t.label.length > 0, `tab ${t.id} のラベルが空`);
  }
});

test("GijiSettingsTab: setActiveTab でタブ切替できる", () => {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
  };
  const tab = new GijiSettingsTab({} as any, plugin as any);
  assert.equal(tab.activeTab, "recording"); // デフォルトは録音
  tab.setActiveTab("summary");
  assert.equal(tab.activeTab, "summary");
  tab.setActiveTab("other");
  assert.equal(tab.activeTab, "other");
});

// ユーザー要求: 「STT モデル接続テスト成功時、成功したモデルの API キーを自動保存」
test("STT 接続テスト成功時に saveSettings が呼ばれ provider 別キーが保存される", async () => {
  // nodeFetch はモジュール読込時に捕捉されるため globalThis.fetch 差し替えでは
  // 効かない。handleSttTest の fetchImpl 注入経由でモックを渡す。
  const fakeFetch = (async () => ({
    ok: true,
    json: async () => ({ text: "こんにちは" }),
  })) as any;
  let saved = 0;
  const plugin = {
    manifest: { version: "0.0.0" },
    settings: {
      ...DEFAULT_SETTINGS,
      sttProvider: "openai" as const,
      sttApiKey: "openai-key",
    },
    saveSettings: async () => {
      saved++;
    },
  };
  const tab = new GijiSettingsTab({} as any, plugin as any);
  await tab.handleSttTest(fakeFetch);
  assert.equal(saved, 1);
  assert.equal((plugin.settings.sttProviderProfiles as any)?.openai?.sttApiKey, "openai-key");
});

// ユーザー要求: 「テスト成功した場合、対応LLMのAPIキーを保存する」
// 接続テスト成功時は saveSettings が呼ばれる（API キーを含む設定が永続化される）
test("LLM 接続テスト成功時に saveSettings が呼ばれる（API キー保存）", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "OK" } }] }),
  })) as any;
  try {
    let saved = 0;
    const plugin = {
      manifest: { version: "0.0.0" },
      settings: {
        ...DEFAULT_SETTINGS,
        llmProvider: "cloud" as const,
        llmBaseUrl: "https://api.example.com/v1",
        llmModel: "test-model",
        llmApiKey: "test-key",
      },
      saveSettings: async () => {
        saved++;
      },
    };
    const tab = new GijiSettingsTab({} as any, plugin as any);
    await tab.handleLlmTest();
    assert.equal(saved, 1);
    // 成功時は provider 別プロファイルにも保存される
    assert.equal((plugin.settings.llmProviderProfiles as any)?.cloud?.llmApiKey, "test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM 接続テスト失敗時は saveSettings が呼ばれない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 401,
    text: async () => "bad key",
  })) as any;
  try {
    let saved = 0;
    const plugin = {
      manifest: { version: "0.0.0" },
      settings: {
        ...DEFAULT_SETTINGS,
        llmProvider: "cloud" as const,
        llmBaseUrl: "https://api.example.com/v1",
        llmModel: "test-model",
        llmApiKey: "bad",
      },
      saveSettings: async () => {
        saved++;
      },
    };
    const tab = new GijiSettingsTab({} as any, plugin as any);
    await tab.handleLlmTest();
    assert.equal(saved, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DEFAULT_SETTINGS defaults to cloud groq", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "groq");
});

test("DEFAULT_SETTINGS sttProvider はクラウド groq 既定", () => {
  assert.equal(DEFAULT_SETTINGS.sttProvider, "groq");
});
test("DEFAULT_SETTINGS は bridge 設定を持たない", () => {
  assert.ok(!("recordingMethod" in DEFAULT_SETTINGS));
  assert.ok(!("bridgeBaseUrl" in DEFAULT_SETTINGS));
  assert.ok(!("bridgeDir" in DEFAULT_SETTINGS));
  assert.equal(DEFAULT_SETTINGS.sttServerDir, "");
  assert.equal(DEFAULT_SETTINGS.pcLoopbackScriptDir, "");
});

// v0.12: 設定UI（録音タブ）からブリッジ関連（録音手法・ブリッジURL・ブリッジディレクトリ）を撤去
// setup.cjs の Setting.addDropdown スタブが contentEl._dropdowns に全 dropdown を蓄積するため、
// 描画後に録音手法（recordingMethod）用の bridge/direct オプションが無いことを検証できる。
test("renderRecordingTab に録音手法（recordingMethod）ドロップダウンが無い", () => {
  const plugin = {
    manifest: { dir: "/mock/plugin" },
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
  };
  const tab = new GijiSettingsTab({} as any, plugin as any);
  const contentEl: any = {
    _setting: undefined,
    _buttons: [],
    _dropdowns: [],
    createEl: () => ({ className: "" }),
  };
  tab.renderRecordingTab(contentEl);
  const dropdowns = contentEl._dropdowns as Array<{ _options: Array<{ value: string; label: string }> }>;
  assert.ok(dropdowns.length >= 3, "録音タブにドロップダウンが生成されていない");
  const allValues = dropdowns.flatMap((d) => d._options.map((o) => o.value));
  // recordingMethod 用の値（bridge / direct）が存在しない
  assert.ok(!allValues.includes("bridge"), "録音手法（recordingMethod）用の bridge オプションが残っている");
  assert.ok(!allValues.includes("direct"), "録音手法（recordingMethod）用の direct オプションが残っている");
  // 録音モード（audioSource）の 3 択（mix / mic / pcLoopback）は残っている
  const audioMode = dropdowns.find((d) =>
    d._options.some((o) => o.value === "mix" || o.value === "pcLoopback")
  );
  assert.ok(audioMode, "録音モード（audioSource）ドロップダウンが無い");
  assert.deepEqual(
    audioMode!._options.map((o) => o.value).filter((v) => v !== ""),
    ["mix", "mic", "pcLoopback"]
  );
});

test("isLocalSttProvider categorizes providers", () => {
  assert.equal(isLocalSttProvider("whisper-local"), true);
  assert.equal(isLocalSttProvider("mywhisper"), true);
  assert.equal(isLocalSttProvider("openai"), false);
  assert.equal(isLocalSttProvider("groq"), false);
  assert.equal(isLocalSttProvider("qwen3-asr"), false);
});

test("sttMaxConcurrency defaults to 2 and validates range 1-4", () => {
  assert.equal(DEFAULT_SETTINGS.sttMaxConcurrency, 2);
});

// v0.12.1: 録音ファイル形式（WAV / MP3）の設定とデフォルト
test("DEFAULT_SETTINGS has recordingFormat = mp3 (default preserves existing behavior)", () => {
  assert.equal(DEFAULT_SETTINGS.recordingFormat, "mp3");
});

test("renderRecordingTab has 録音ファイルの形式 dropdown with mp3 / wav options", () => {
  const plugin = {
    manifest: { dir: "/mock/plugin" },
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
  };
  const tab = new GijiSettingsTab({} as any, plugin as any);
  const contentEl: any = {
    _setting: undefined,
    _buttons: [],
    _dropdowns: [],
    createEl: () => ({ className: "" }),
  };
  tab.renderRecordingTab(contentEl);
  const dropdowns = contentEl._dropdowns as Array<{ _options: Array<{ value: string; label: string }> }>;
  // 録音ファイルの形式 用の dropdown が存在する
  const formatDropdown = dropdowns.find(
    (d) => d._options.some((o) => o.value === "mp3") && d._options.some((o) => o.value === "wav")
  );
  assert.ok(formatDropdown, "録音ファイルの形式 ドロップダウン（mp3 / wav）が無い");
  // ラベルが要件どおり（MP3（64kbps・推奨）/ WAV（16kHz・PCM・無圧縮））
  const labels = formatDropdown!._options.map((o) => o.label);
  assert.ok(labels.some((l) => l.includes("MP3") && l.includes("64kbps")), "MP3 ラベルに 64kbps が含まれる");
  assert.ok(labels.some((l) => l.includes("WAV") && l.includes("PCM") && l.includes("16kHz")), "WAV ラベルに 16kHz・PCM が含まれる");
  // 現在の選択は DEFAULT_SETTINGS.recordingFormat に従う
  assert.equal(formatDropdown!._value, "mp3");
});

test("sttMaxConcurrency is clamped to valid range", () => {
  const settings = { ...DEFAULT_SETTINGS, sttMaxConcurrency: 0 };
  assert.equal(clampSttConcurrency(settings.sttMaxConcurrency), 1);
  assert.equal(clampSttConcurrency(5), 4);
  assert.equal(clampSttConcurrency(3), 3);
});


/* ---------------- v0.14.0: 更新確認ボタン ---------------- */

import { buildUpdateButton } from "../settings";

test("buildUpdateButton: 更新確認ラベルのボタンを生成する", () => {
  const created: any[] = [];
  const parent: any = {
    createEl(tag: string, opts?: any) {
      const el: any = {
        tag,
        text: opts?.text,
        style: { cssText: "" },
        disabled: false,
        _listeners: [] as Array<() => void>,
        addEventListener(_ev: string, fn: () => void) { this._listeners.push(fn); },
      };
      created.push(el);
      return el;
    },
  };
  const btn = buildUpdateButton(parent, async () => {});
  assert.equal(created.length, 1);
  assert.equal(btn.text, "🔄 更新を確認");
  assert.equal(btn.tag, "button");
});

test("buildUpdateButton: 処理中は disabled・完了後に再有効化", async () => {
  let resolveFn: (() => void) | null = null;
  const parent: any = {
    createEl(_tag: string, _opts?: any) {
      const el: any = {
        style: { cssText: "" },
        disabled: false,
        _listeners: [] as Array<() => void>,
        addEventListener(_ev: string, fn: () => void) { this._listeners.push(fn); },
      };
      return el;
    },
  };
  const btn = buildUpdateButton(parent, async () => {
    await new Promise<void>((r) => { resolveFn = r; });
  });
  assert.equal(btn._listeners.length, 1);
  const p = btn._listeners[0]();
  assert.equal(btn.disabled, true, "処理中は disabled");
  (resolveFn as unknown as () => void)();
  await p;
  assert.equal(btn.disabled, false, "完了後に再有効化");
});
