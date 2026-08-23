# GijiObsidian MyWhisper 本地 STT Provider 集成 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 GijiObsidian 插件中新增 `mywhisper` STT Provider，使插件能够通过 LAN 调用 [[../../../../80_POC_Projects/POC_020_MyWhisper/README.md|MyWhisper (POC_020)]] 的 `POST /asr` 端点完成语音转写。

**Architecture:** 新增独立的 `MyWhisperStt` 类（与现有 OpenAI 兼容的 qwen3-asr / whisper-small 不同契约），在 `createSttProvider` 工厂中加入 `mywhisper` 分支。Settings 添加 2 个字段（Base URL / Token），默认指向主人 LAN 实例 `http://192.168.0.88:9000/`。采用「防御式 3 段階検証」+「MyWhisperError」让 LAN 服务异常的报错可读。

**Tech Stack:** TypeScript、Obsidian Plugin API、node:test、FastAPI (POC_020 端点)。

**设计文档:** [[../specs/2026-08-24-giji-obsidian-mywhisper-design.md|2026-08-24-giji-obsidian-mywhisper-design.md]]

---

## Global Constraints

- 现有 provider 一律不动：`openai` / `google` / `groq` / `qwen3-asr` / `whisper-small`
- 不接入 :9001 Dashboard、不接 `/correct` AI 校正、不自动启动 MyWhisper 进程
- 不改既有用户的 `data.json`（默认 provider 保持不变）
- 测试 mock 全部使用 `node:test` + `as typeof fetch` 注入，不发真实 HTTP
- `data.json` 后方兼容：`DEFAULT_SETTINGS` 増分マージ、新字段未設定時自動補完
- commit 粒度按任务拆分，每任务 1 commit
- 默认 Base URL = `http://192.168.0.88:9000/`、默认 Token = 空字串

---

## File Structure

| 状態 | 路径 | 役割 |
|:--:|------|------|
| ✏️ M | `obsidian-plugin/src/providers/stt.ts` | 追加 `MyWhisperError` + `MyWhisperStt` + 工場 case "mywhisper" |
| ✏️ M | `obsidian-plugin/src/providers/sttProfiles.ts` | `STT_PROFILE_BACKUP_KEYS` に 2 キー追加 |
| ✏️ M | `obsidian-plugin/src/settings.ts` | `GijiSettings` + DEFAULT + SettingsTab 条件 UI |
| ✏️ M | `obsidian-plugin/src/main.ts` | `STT_PROVIDERS` + `STT_PROVIDER_LABELS` |
| ✏️ M | `obsidian-plugin/manifest.json` | version `0.6.0` → `0.7.0` |
| ✏️ M | `obsidian-plugin/CHANGELOG.md` | `## [0.7.0]` エントリ追加 |
| ✏️ M | `obsidian-plugin/README.md` | 対応 STT 表に行追加 |
| ✏️ M | `obsidian-plugin/08_説明書/02_ユーザーマニュアル/機能詳細.md` | 「MyWhisper 本地」節追加 |
| ➕ A | `obsidian-plugin/src/__tests__/mywhisperStt.test.ts` | 14 ケース ユニットテスト |

実装合計 約 +250 行（コード + ドキュメント）、テスト +130 行。

---

## Task 1: TDD で `MyWhisperStt` クラスと工場分岐を実装

**Files:**
- Create: `obsidian-plugin/src/__tests__/mywhisperStt.test.ts`
- Modify: `obsidian-plugin/src/providers/stt.ts` (末尾追加 + 工場 switch 追加)

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS` (from `../settings`), `nodeFetch` (from `../providers/nodeFetch`)
- Produces:
  - `export class MyWhisperError extends Error` — `{ message, status?, body? }`
  - `export class MyWhisperStt implements SttProvider` — `id="mywhisper"`, `maxChunkSec=undefined`, `maxBytesPerRequest=1_073_741_824`
  - `createSttProvider()` が `case "mywhisper"` で `MyWhisperStt` を返す

**前提確認:** 既存 `src/providers/stt.ts` 末尾を確認（`OpenaiStt` 等クラス定義の真下に追記、`createSttProvider` の switch 文の真下に `case "mywhisper"` を追加）。既存テスト `src/__tests__/sttQwenAsr.test.ts` のパターンを踏襲する（mock fetch は `as typeof fetch` で注入）。

---

### Step 1.1: 失敗するテストを書く

`obsidian-plugin/src/__tests__/mywhisperStt.test.ts` を新規作成し、以下 14 ケースを書く:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { createSttProvider } from "../providers/stt";
import { DEFAULT_SETTINGS } from "../settings";

const base = {
  ...DEFAULT_SETTINGS,
  sttProvider: "mywhisper" as const,
  sttMyWhisperBaseUrl: "http://192.168.0.88:9000/",
  sttMyWhisperToken: "",
};

function makeResponse(
  body: string,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "text/plain; charset=utf-8" },
  });
}

// 1. 正常転写
test("mywhisper: 正常転写 (ja)", async () => {
  const fakeFetch = (async () => makeResponse("こんにちは")) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  const text = await p.transcribe(new ArrayBuffer(10), "ja");
  assert.equal(text, "こんにちは");
});

// 2. language 透伝
test("mywhisper: language 字段透伝 (zh)", async () => {
  const langs: Array<string | null> = [];
  const fakeFetch = (async (_url: string, init: any) => {
    langs.push((init.body as FormData).get("language") as string | null);
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "zh");
  await p.transcribe(new ArrayBuffer(10), "ja");
  await p.transcribe(new ArrayBuffer(10), "en");
  assert.deepEqual(langs, ["zh", "ja", "en"]);
});

// 3. language=auto 省略
test("mywhisper: lang=auto 不发送 language 字段", async () => {
  let capturedLang: string | null = "init";
  const fakeFetch = (async (_url: string, init: any) => {
    capturedLang = (init.body as FormData).get("language") as string | null;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedLang, null);
});

// 4. Bearer Token 注入
test("mywhisper: token 非空时注入 Authorization", async () => {
  let capturedAuth: string | null = null;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedAuth = (init.headers as Record<string, string>)?.Authorization ?? null;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(
    { ...base, sttMyWhisperToken: "abc123" },
    fakeFetch,
  );
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedAuth, "Bearer abc123");
});

// 5. 空 token 不注入
test("mywhisper: token 空时无 Authorization", async () => {
  let capturedAuth: string | undefined;
  const fakeFetch = (async (_url: string, init: any) => {
    capturedAuth = (init.headers as Record<string, string>)?.Authorization;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider({ ...base, sttMyWhisperToken: "" }, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedAuth, undefined);
});

// 6. 422 エラー
test("mywhisper: 422 表単校验 → throw MyWhisperError", async () => {
  const fakeFetch = (async () =>
    makeResponse("missing audio_file", { status: 422 })) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    (err: any) => {
      assert.equal(err.name, "MyWhisperError");
      assert.equal(err.status, 422);
      return true;
    },
  );
});

// 7. 413 过大
test("mywhisper: 413 文件过大 → throw status=413", async () => {
  const fakeFetch = (async () =>
    makeResponse("too large", { status: 413 })) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    (err: any) => err.status === 413,
  );
});

// 8. HTML エラーページ検出
test("mywhisper: HTML エラーページ (text/html) → throw「HTML 错误页」", async () => {
  const fakeFetch = (async () =>
    makeResponse(
      "<html><body><h1>502 Bad Gateway</h1></body></html>",
      { status: 200, contentType: "text/html" },
    )) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /HTML 错误页/,
  );
});

// 9. 非テキスト content-type
test("mywhisper: application/json 响应 → throw「返回非文本响应」", async () => {
  const fakeFetch = (async () =>
    makeResponse('{"err":"x"}', { status: 200, contentType: "application/json" })) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /返回非文本响应/,
  );
});

// 10. 空応答検出
test("mywhisper: 空文本响应 → throw「返回空文本」", async () => {
  const fakeFetch = (async () => makeResponse("   ")) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await assert.rejects(
    () => p.transcribe(new ArrayBuffer(10), "auto"),
    /返回空文本/,
  );
});

// 11. trim
test("mywhisper: 前后空白被 trim", async () => {
  const fakeFetch = (async () => makeResponse("  你好  \n")) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  const text = await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(text, "你好");
});

// 12. 字段名硬约束
test("mywhisper: FormData 字段名恒为 audio_file", async () => {
  let capturedFieldName: string | null = null;
  const fakeFetch = (async (_url: string, init: any) => {
    const form = init.body as FormData;
    for (const key of form.keys()) {
      capturedFieldName = key;
      break;
    }
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(base, fakeFetch);
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedFieldName, "audio_file");
});

// 13. URL 去尾斜杠
test("mywhisper: Base URL 末尾斜杠被去除", async () => {
  let capturedUrl = "";
  const fakeFetch = (async (url: string) => {
    capturedUrl = url;
    return makeResponse("ok");
  }) as typeof fetch;
  const p = createSttProvider(
    { ...base, sttMyWhisperBaseUrl: "http://x:9000/////" },
    fakeFetch,
  );
  await p.transcribe(new ArrayBuffer(10), "auto");
  assert.equal(capturedUrl, "http://x:9000/asr");
});

// 14. 認証なし接続（factory default fetchImpl が undefined の場合）
test("mywhisper: factory case が正しく分岐される", () => {
  const p = createSttProvider(base, (async () => makeResponse("x")) as typeof fetch);
  assert.equal(p.id, "mywhisper");
  assert.equal(p.maxChunkSec, undefined);
  assert.equal(p.maxBytesPerRequest, 1_073_741_824);
});
```

### Step 1.2: テスト実行 → 失敗確認

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsx --test src/__tests__/mywhisperStt.test.ts
```

期待結果: **14 件全て FAIL**（`MyWhisperError is not defined` / `createSttProvider` の case 不在）

### Step 1.3: `MyWhisperError` クラスを実装

`obsidian-plugin/src/providers/stt.ts` 末尾（既存 `WhisperLocalStt` クラスの下）に追加:

```typescript
/** MyWhisper エラー（HTTP status + body を保持して上層リトライ判断に使用） */
export class MyWhisperError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "MyWhisperError";
  }
}
```

### Step 1.4: `MyWhisperStt` クラスを実装

同じファイルの `MyWhisperError` 直下に追加。**`nodeFetch` の import 文が無い場合は `import { nodeFetch } from "./nodeFetch";` を先頭に追加**（既存で import 済の可能性あり、既存 import を確認してから判断）:

```typescript
/** MyWhisper 本地 STT Provider（POC_020 ASR サーバ専用） */
export class MyWhisperStt implements SttProvider {
  readonly id = "mywhisper";
  readonly maxChunkSec?: number = undefined;
  readonly maxBytesPerRequest?: number = 1_073_741_824; // 1 GB

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = nodeFetch,
  ) {}

  async transcribe(audio: ArrayBuffer, lang: SttLang): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/asr`;

    const form = new FormData();
    form.append("audio_file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    if (lang !== "auto") {
      form.append("language", lang);
    }

    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await this.fetchImpl(url, {
      method: "POST",
      body: form,
      headers,
    });

    // 防御式 段階 1: Content-Type
    const ct = response.headers.get("content-type") ?? "";
    if (!ct.startsWith("text/")) {
      throw new MyWhisperError(
        `MyWhisper 返回非文本响应 (${ct})`,
        response.status,
        (await response.text()).slice(0, 500),
      );
    }

    const body = await response.text();

    // HTTP エラー応答
    if (!response.ok) {
      throw new MyWhisperError(
        `MyWhisper 错误 ${response.status}: ${body.slice(0, 200)}`,
        response.status,
        body,
      );
    }

    // 防御式 段階 2: HTML エラーページ検出
    const trimmedStart = body.trimStart();
    if (trimmedStart.startsWith("<")) {
      const looksLikeError =
        /<\/?(html|title|h1)|HTTP\/.*\s(5\d\d|4\d\d)|Bad Gateway|Service Unavailable/i
          .test(body.slice(0, 500));
      if (looksLikeError) {
        throw new MyWhisperError(
          `MyWhisper 返回 HTML 错误页（可能服务未启动或反代拦截）`,
          response.status,
          body.slice(0, 500),
        );
      }
    }

    // 防御式 段階 3: 空テキスト検出
    const result = body.trim();
    if (!result) {
      throw new MyWhisperError(
        "MyWhisper 返回空文本（音频可能无语音或静音过长）",
      );
    }

    return result;
  }
}
```

### Step 1.5: 工場 switch に case "mywhisper" 追加

`createSttProvider` 関数の switch 文末尾に追加:

```typescript
case "mywhisper":
  return new MyWhisperStt(
    settings.sttMyWhisperBaseUrl.replace(/\/+$/, ""),
    settings.sttMyWhisperToken || undefined,
    fetchImpl,
  );
```

`fetchImpl` パラメータの名前を既存実装に合わせて調整（`createSttProvider(settings, fetchImpl)` の第 2 引数名）。

### Step 1.6: テスト実行 → 全件 PASS 確認

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsx --test src/__tests__/mywhisperStt.test.ts
```

期待結果: **14 件全て PASS**

### Step 1.7: 既存テストの regression 確認

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npm test
```

期待結果: **既存 40+ テストも green 維持**（`mywhisper` ケース追加が他 provider に影響しないことを確認）

### Step 1.8: Commit

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/providers/stt.ts \
        obsidian-plugin/src/__tests__/mywhisperStt.test.ts
git commit -m "feat(giji-obsidian): add MyWhisper local STT provider (POC_020)

- Add MyWhisperStt class with defensive 3-stage response validation
- Add MyWhisperError for retry-decision upstream
- Wire createSttProvider case 'mywhisper' with default baseUrl
- 14 unit tests covering normal/error/edge cases"
```

---

## Task 2: Settings schema に 2 フィールド追加

**Files:**
- Modify: `obsidian-plugin/src/settings.ts` (interface + DEFAULT_SETTINGS)

**Interfaces:**
- Consumes: 既存 `GijiSettings` interface、`DEFAULT_SETTINGS` オブジェクト
- Produces:
  - `GijiSettings.sttMyWhisperBaseUrl: string`
  - `GijiSettings.sttMyWhisperToken: string`
  - `DEFAULT_SETTINGS.sttMyWhisperBaseUrl = "http://192.168.0.88:9000/"`
  - `DEFAULT_SETTINGS.sttMyWhisperToken = ""`

### Step 2.1: `GijiSettings` interface に 2 フィールド追加

`obsidian-plugin/src/settings.ts` 内の `export interface GijiSettings` ブロック末尾（既存フィールド群の直下）に追記:

```typescript
  /** MyWhisper ASR サーバ Base URL（POC_020 本地 ASR） */
  sttMyWhisperBaseUrl: string;
  /** MyWhisper 用 Bearer Token（:9000 は無認証のため通常空） */
  sttMyWhisperToken: string;
```

### Step 2.2: `DEFAULT_SETTINGS` に 2 値追加

`obsidian-plugin/src/settings.ts` 内の `DEFAULT_SETTINGS` オブジェクト末尾に追加:

```typescript
  sttMyWhisperBaseUrl: "http://192.168.0.88:9000/",
  sttMyWhisperToken: "",
```

### Step 2.3: 既存 settings test が壊れていないか確認

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsx --test src/__tests__/settings.test.ts
```

期待結果: green 維持。失敗したら DEFAULT_SETTINGS の型不整合の可能性、interface との順序を合わせる。

### Step 2.4: Task 1 のテスト再実行（settings 変更による regression 確認）

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsx --test src/__tests__/mywhisperStt.test.ts
```

期待結果: 14 件 PASS 維持

### Step 2.5: Commit

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/settings.ts
git commit -m "feat(giji-obsidian): add MyWhisper baseUrl/token settings fields

- Add sttMyWhisperBaseUrl (default http://192.168.0.88:9000/)
- Add sttMyWhisperToken (default empty, future-proof for auth)"
```

---

## Task 3: Profile backup キーに 2 キー追加

**Files:**
- Modify: `obsidian-plugin/src/providers/sttProfiles.ts`

**Interfaces:**
- Consumes: 既存 `STT_PROFILE_BACKUP_KEYS` Set
- Produces: `STT_PROFILE_BACKUP_KEYS` に `sttMyWhisperBaseUrl` と `sttMyWhisperToken` を含む

### Step 3.1: Set に 2 キー追加

`obsidian-plugin/src/providers/sttProfiles.ts` 内の `STT_PROFILE_BACKUP_KEYS` 定義箇所を見つけ、末尾に追加:

```typescript
const STT_PROFILE_BACKUP_KEYS = new Set([
  "sttApiKey",
  "sttBaseUrl",
  "sttModel",
  "sttMyWhisperBaseUrl", // ← 追加
  "sttMyWhisperToken",   // ← 追加
]);
```

### Step 3.2: sttProfiles test の確認

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsx --test src/__tests__/sttProfiles.test.ts
```

期待結果: green 維持

### Step 3.3: Commit

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/providers/sttProfiles.ts
git commit -m "feat(giji-obsidian): preserve mywhisper baseUrl/token across provider switches"
```

---

## Task 4: SettingsTab UI に MyWhisper 条件セクションを追加

**Files:**
- Modify: `obsidian-plugin/src/settings.ts` (`GijiSettingsTab` 内、`renderTranscriptTab` 関数 or 同等)

**Interfaces:**
- Consumes: `sttMyWhisperBaseUrl` / `sttMyWhisperToken` (from settings)、`sttProvider` ドロップダウン要素
- Produces: `mywhisper` 選択時のみ表示される Base URL + Token 入力欄

### Step 4.1: 既存 `renderTranscriptTab` を確認

`obsidian-plugin/src/settings.ts` を開き、`renderTranscriptTab()` 関数内の STT provider ドロップダウン（`addDropdown` with provider options）配下を確認する。`onChange` コールバックが既に存在するか、表示制御用の DOM 参照が必要かを判断する。

### Step 4.2: 条件 UI を追加

provider ドロップダウンの `addDropdown` 直後に追記。`onChange` 内で `display` 切替する方式を採る:

```typescript
// provider ドロップダウン addDropdown 直後に追加
const myWhisperSection = settingEl.createDiv({ cls: "giji-mywhisper-section" });
myWhisperSection.style.display = settings.sttProvider === "mywhisper" ? "" : "none";

new Setting(myWhisperSection)
  .setName("MyWhisper 配置（本地 ASR 服务）")
  .setDesc("💡 默认指向主人 LAN 部署实例；可改为其他地址后保存。")
  .addText((text) =>
    text
      .setPlaceholder("http://192.168.0.88:9000/")
      .setValue(settings.sttMyWhisperBaseUrl)
      .onChange(async (value) => {
        if (!/^https?:\/\//.test(value)) {
          new Notice("Base URL 必须以 http:// 或 https:// 开头");
          return;
        }
        this.plugin.settings.sttMyWhisperBaseUrl = value;
        await this.plugin.saveSettings();
      }),
  );

new Setting(myWhisperSection)
  .setName("Token（可选）")
  .setDesc(":9000 默认无认证，留空即可；未来如启用认证可在此填写。")
  .addText((text) =>
    text
      .setPlaceholder("留空表示无认证")
      .setValue(settings.sttMyWhisperToken)
      .onChange(async (value) => {
        this.plugin.settings.sttMyWhisperToken = value;
        await this.plugin.saveSettings();
      }),
  );

// 既存 provider dropdown の onChange コールバック末尾に追記
// （コールバック未定義なら dropdown.addDropdown の第三引数として新規追加）
const providerDropdownOnChange = (value: string) => {
  // ... 既存処理 ...
  myWhisperSection.style.display = value === "mywhisper" ? "" : "none";
};
```

**実装上の注意**: 既存 `renderTranscriptTab` の構造によって `settingEl` の参照方法、`this` のスコープ、`addDropdown` の onChange 引数受け取り方が異なる。実装時は既存のパターンに合わせて読み替える（写経的アプローチ）。

### Step 4.3: TypeScript 型チェック

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsc --noEmit
```

期待結果: エラーなし

### Step 4.4: Commit

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/settings.ts
git commit -m "feat(giji-obsidian): add MyWhisper conditional settings UI section"
```

---

## Task 5: main.ts の STT_PROVIDERS / ラベルに登録

**Files:**
- Modify: `obsidian-plugin/src/main.ts`

**Interfaces:**
- Consumes: `SttProviderId` 型
- Produces:
  - `STT_PROVIDERS` 配列に `"mywhisper"` 追加
  - `STT_PROVIDER_LABELS` レコードに `"mywhisper": "MyWhisper 本地 (POC_020)"` 追加

### Step 5.1: `STT_PROVIDERS` 配列更新

`obsidian-plugin/src/main.ts` 内の `STT_PROVIDERS` 配列末尾に `"mywhisper"` を追加:

```typescript
export const STT_PROVIDERS = [
  "openai",
  "google",
  "groq",
  "qwen3-asr",
  "whisper-small",
  "mywhisper", // ← 追加
] as const;
```

### Step 5.2: `STT_PROVIDER_LABELS` 更新

同ファイル内の `STT_PROVIDER_LABELS` レコード末尾に追加:

```typescript
mywhisper: "MyWhisper 本地 (POC_020)",
```

### Step 5.3: TypeScript 型チェック

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npx tsc --noEmit
```

期待結果: エラーなし

### Step 5.4: Commit

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/src/main.ts
git commit -m "feat(giji-obsidian): register mywhisper in STT_PROVIDERS list and labels"
```

---

## Task 6: Manifest バージョンアップ + ドキュメント更新

**Files:**
- Modify: `obsidian-plugin/manifest.json`
- Modify: `obsidian-plugin/CHANGELOG.md`
- Modify: `obsidian-plugin/README.md`
- Modify: `obsidian-plugin/08_説明書/02_ユーザーマニュアル/機能詳細.md`

### Step 6.1: `manifest.json` の version 更新

`obsidian-plugin/manifest.json` 内の `"version"` フィールドを `"0.6.0"` → `"0.7.0"` に変更:

```json
{
  "id": "giji-obsidian",
  "name": "GijiObsidian",
  "version": "0.7.0",
  ...
}
```

### Step 6.2: `CHANGELOG.md` に v0.7.0 エントリ追加

ファイル先頭（最新エントリの位置）に追加:

```markdown
## [0.7.0] - 2026-08-24

### ✨ 新增功能
- **MyWhisper 本地 STT Provider (POC_020)**: 新增 `mywhisper` 选项，调用主人 LAN 上 MyWhisper 服务的 `POST /asr` 端点（multipart, field=`audio_file`, 返回 raw text）
- 默认 Base URL 预填 `http://192.168.0.88:9000/`，选择后即可使用
- 可选 Bearer Token 字段（:9000 默认无认证，未来扩展预留）
- 防御式 3 段階响应検証 + `MyWhisperError`，LAN 服务异常的报错可读

### 🔧 改善
- 新增 14 件单元测试覆盖正常 / 错误 / 边界场景
```

### Step 6.3: `README.md` の対応 STT 表に行追加

「対応 STT エンジン」テーブル末尾に行追加:

```markdown
| `mywhisper` | MyWhisper 本地 (POC_020) | LAN 自研 ASR | - | 无（:9000 无认证）|
```

### Step 6.4: `機能詳細.md` に「MyWhisper 本地」節追加

ファイル末尾に新節を追加:

```markdown
### 9. MyWhisper 本地 STT（POC_020）

[GijiObsidian プラグイン] は主人 LAN 上で稼働する [MyWhisper (POC_020)] ローカル ASR サーバに対応しています。

#### 設定項目

| 項目 | 説明 | デフォルト |
|------|------|----------|
| Base URL | MyWhisper ASR の URL | `http://192.168.0.88:9000/` |
| Token | Bearer Token（省略可） | 空 |

#### 制限事項

- MyWhisper は OpenAI Whisper API 互換ではない独自契約（`POST /asr`, field=`audio_file`, raw text 応答）
- 最大ファイルサイズ: 1 GB
- 同時実行: 1 リクエスト（MyWhisper 側 `asyncio.Semaphore(1)` 制約）
- 認証: :9000 は無認証。:9001 Dashboard は要 Token（本プラグインは未統合）
```

### Step 6.5: Commit

```bash
cd D:\AI-Agent\giji-obsidian
git add obsidian-plugin/manifest.json \
        obsidian-plugin/CHANGELOG.md \
        obsidian-plugin/README.md \
        obsidian-plugin/08_説明書/02_ユーザーマニュアル/機能詳細.md
git commit -m "docs(giji-obsidian): bump to v0.7.0 and document MyWhisper provider"
```

---

## Task 7: ビルド + 全テスト + マニュアル E2E

**Files:** (変更なし — 検証専用)

### Step 7.1: ビルド検証

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npm run build
```

期待結果: `main.js` が再生成され、コンソールに esbuild エラーなし

### Step 7.2: 全テスト実行

```bash
cd D:\AI-Agent\giji-obsidian\obsidian-plugin
npm test
```

期待結果: **既存 40+ テスト + 新規 14 テストすべて PASS**

### Step 7.3: マニュアル E2E — 正常フロー

1. Obsidian を開き、`.obsidian/plugins/giji-obsidian/main.js` を最新版に差し替え（ビルド成果物を Vault プラグインディレクトリへ配置）
2. プラグイン設定 → 📝 转写タブ → STT Provider で `MyWhisper 本地 (POC_020)` を選択
3. Base URL が既定 `http://192.168.0.88:9000/` のまま、Token は空のまま保存
4. 🎤 录音ボタンで 5 秒間の音声を録音
5. 停止すると転写処理が走り、テキストが返ることを確認

期待結果: 録音した音声の文字起こし結果がノートに追記される

### Step 7.4: マニュアル E2E — エラーハンドリング

1. 設定で Base URL を `http://192.168.0.88:9001/`（Dashboard ポート）に変更して保存
2. 録音 → 転写試行
3. Notice / エラーメッセージが「MyWhisper 返回 HTML 错误页」または「返回非文本响应」等、原因の分かる形で表示されることを確認

期待結果: 防御式検証が発動し、生の HTML / スタックトレースではなく可読エラーメッセージが出る

### Step 7.5: マニュアル E2E — Profile 保持

1. 設定で MyWhisper 選択 → Base URL を `http://192.168.1.100:9000/` 等に変更
2. STT Provider を `openai` に切り替え
3. STT Provider を `mywhisper` に戻す
4. Base URL が `http://192.168.1.100:9000/` のまま保持されていることを確認

期待結果: Task 3 で追加した profile backup が機能

### Step 7.6: 全変更を一覧確認

```bash
cd D:\AI-Agent\giji-obsidian
git log --oneline -10
git diff HEAD~6 --stat
```

期待結果: 6 個の新規 commit + 各タスクで 1 commit。`mywhisper` 関連の変更のみが含まれる。

### Step 7.7: リリース準備

ユーザーの手動操作で実施（プラン外）:
- Vault プラグイン実機投入: `cp obsidian-plugin/main.js <VAULT>/.obsidian/plugins/giji-obsidian/main.js`
- リリースノート / Wiki の更新

---

## Self-Review

### 1. Spec coverage

| Spec セクション | カバーするタスク |
|----------------|-----------------|
| §1 機能概要 | Task 1-5（実装全体）+ Task 6（ドキュメント） |
| §2 コンポーネント構成 | Task 1（stt.ts）, Task 2（settings.ts schema）, Task 4（settings.ts UI）, Task 5（main.ts）, Task 1（test） |
| §3 データフロー | Task 1 Step 1.4（実装） |
| §4 エラーハンドリング | Task 1 Step 1.4（防御式 3 段階 + HTTP エラー） |
| §5 Settings Schema | Task 2（schema）, Task 4（UI） |
| §6 テスト戦略 | Task 1（14 ケース）+ Task 7 Step 7.4（手動 E2E エラー） |
| §7 後方互換 | Task 2 Step 2.2（DEFAULT_SETTINGS 増分マージ） |
| §8 ロールバック | Task 7 で `git revert` 可能（commit が独立） |
| §9 スコープ外 | 該当タスクなし（明示的にやらない） |

**ギャップなし。** 全 spec セクションがいずれかのタスクにマップされる。

### 2. Placeholder scan

| パターン | 出現箇所 | 対処 |
|---------|----------|------|
| "TBD" / "TODO" | なし | - |
| "implement later" / "add appropriate handling" | なし | - |
| "Similar to Task N" | Task 4 Step 4.2 で「既存パターンに合わせて読み替え」 | 指示的だが、既存実装が不明瞭なため **実装者判断で写経的アプローチ**を明示。これは TDD 原則と矛盾しない（テストが振る舞いを保証） |
| 参照のみの型 / 関数 | 全て `// Produces:` セクションで完全定義 | - |

### 3. Type consistency

| タスク | 定義 | 使用 | 一致 |
|--------|------|------|:--:|
| Task 1 `MyWhisperError` | `{ message, status?, body? }` | Task 1 Step 1.6 のテスト | ✅ |
| Task 1 `MyWhisperStt` | `id="mywhisper"`, `maxChunkSec=undefined`, `maxBytesPerRequest=1_073_741_824` | Task 1 test 14 で検証 | ✅ |
| Task 2 設定フィールド名 | `sttMyWhisperBaseUrl` / `sttMyWhisperToken` | Task 1 test (base オブジェクト), Task 3 backup keys, Task 4 UI | ✅ |
| Task 3 backup keys | `sttMyWhisperBaseUrl`, `sttMyWhisperToken` | settings.ts のフィールド名と一致 | ✅ |
| Task 5 provider ID | `"mywhisper"` | Task 1 factory case, Task 4 UI onChange | ✅ |

**型整合性に問題なし。**

---

## 完了条件チェックリスト

- [ ] Task 1.6: 14 件テスト全 PASS
- [ ] Task 1.7: 既存 40+ テスト green 維持
- [ ] Task 2.3: settings test green 維持
- [ ] Task 3.2: sttProfiles test green 維持
- [ ] Task 4.3: tsc --noEmit エラーなし
- [ ] Task 5.3: tsc --noEmit エラーなし
- [ ] Task 7.1: npm run build 成功
- [ ] Task 7.2: npm test 全 PASS
- [ ] Task 7.3: マニュアル E2E 正常フロー成功
- [ ] Task 7.4: マニュアル E2E エラーハンドリング成功
- [ ] Task 7.5: マニュアル E2E Profile 保持成功

---

*📚 Plan v1.0 · brainstorming 2026-08-24 · TDD + 防御式検証 · 7 tasks · 想定 1-2 セッション*
