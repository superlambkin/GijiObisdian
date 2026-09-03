# GijiObsidian 自己更新機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定画面のバージョンパネルに「🔄 更新を確認」ボタンを追加し、GitHub Releases からの更新確認〜自動更新（バックアップ→DL→再読込）を実現する。

**Architecture:** ClaudianBridge v0.32.10 の `src/features/self-update/` を GijiObsidian 向けに移植。`src/selfUpdate/` にモジュール群（types / http / updateChecker / backupManager / updateDownloader / reloader / index）を新設し、`GijiSettingsTab.display()` の `giji-version-info` パネルから `runSelfUpdate()` を呼ぶ。配布元は GitHub Actions で生成する Releases アセット。

**Tech Stack:** TypeScript / esbuild / Obsidian API（requestUrl・DataAdapter）/ Node 組み込み test runner（`npm test`）

**Spec:** `docs/superpowers/specs/2026-09-04-self-update-design.md`

## Global Constraints

- リポジトリ: `D:\AI-Agent\GijiObsidian`、プラグイン本体は `obsidian-plugin/` 配下
- テスト実行: `cd obsidian-plugin && npm test`（node:test・現状 359 件 pass、全件 pass を維持）
- `obsidian` モジュールは `src/__tests__/setup.cjs` がスタブする（`requestUrl` スタブなし → テストでは fetch にフォールバックする）
- i18n 機構なし。UI 文言・Notice は日本語ハードコード
- 更新対象ファイル: `main.js` / `manifest.json` / `styles.css` / `worker.js` / `ffmpeg-core.js`
- GitHub リポジトリ URL: `superlambkin/GijiObisdian`（typo のままが実体）
- バージョンは v0.14.0 へ 4 箇所統一: `obsidian-plugin/manifest.json` / `obsidian-plugin/package.json` / `recorder-bridge/config.py` の `VERSION` / `obsidian-plugin/CHANGELOG.md`
- コミットメッセージ: `feat(plugin): ... (v0.14.0)` 形式（途中コミットはタスク番号でも可、最終はバージョン添え）
- 仕様ソース（参考実装）: `D:\AI-Agent\ClaudianBridge\src\features\self-update\` — 移植時に関数名・挙動を可能な限り一致させる

---

### Task 1: types と http ヘルパー

**Files:**
- Create: `obsidian-plugin/src/selfUpdate/types.ts`
- Create: `obsidian-plugin/src/selfUpdate/http.ts`
- Test: `obsidian-plugin/src/__tests__/selfUpdate/http.test.ts`

**Interfaces:**
- Produces: `ReleaseAsset { name: string; browser_download_url: string }`、`UpdateCheckResult { updateAvailable: boolean; tagName: string; assets: ReleaseAsset[] }`、`httpGet(url: string, headers: Record<string, string>): Promise<HttpResponse>`（`HttpResponse { status: number; ok: boolean; json(): Promise<unknown> }`）

- [ ] **Step 1: テストを書く（失敗確認）**

```ts
// obsidian-plugin/src/__tests__/selfUpdate/http.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { httpGet } from "../../selfUpdate/http";

test("httpGet: obsidian 未解決環境では fetch にフォールバックする", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v0.14.0" }),
    } as unknown as Response;
  });
  const res = await httpGet("https://example.com/api", { Accept: "application/json" });
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), { tag_name: "v0.14.0" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/api");
});
```

Run: `cd obsidian-plugin && npm test 2>&1 | grep -A2 "selfUpdate"` — `src/__tests__/` の glob で自動収集される
Expected: FAIL（`../../selfUpdate/http` が存在しない）

- [ ] **Step 2: 実装**

```ts
// obsidian-plugin/src/selfUpdate/types.ts
/** GitHub Release のアセット（配布ファイル） */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** 更新チェック結果 */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  tagName: string;
  assets: ReleaseAsset[];
}
```

```ts
// obsidian-plugin/src/selfUpdate/http.ts
// CORS を回避する HTTP GET ヘルパー。
// Obsidian では requestUrl（メインプロセス経由）、テスト等では fetch にフォールバック。

export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

type RequestUrlLike = (opts: {
  url: string;
  method: string;
  headers: Record<string, string>;
}) => Promise<{ status: number; json?: unknown; text?: string; arrayBuffer?: ArrayBuffer }>;

function resolveObsidianRequestUrl(): RequestUrlLike | null {
  try {
    const obs = require("obsidian") as { requestUrl?: RequestUrlLike };
    if (typeof obs.requestUrl === "function") return obs.requestUrl;
  } catch {
    /* obsidian 未解決環境（テスト等）は無視 */
  }
  return null;
}

let cached: RequestUrlLike | null | undefined;
function getRequestUrl(): RequestUrlLike | null {
  if (cached === undefined) cached = resolveObsidianRequestUrl();
  return cached;
}

export async function httpGet(url: string, headers: Record<string, string>): Promise<HttpResponse> {
  const ru = getRequestUrl();
  if (ru) {
    const res = await ru({ url, method: "GET", headers });
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      async json() {
        if (res.json !== undefined) return res.json;
        return JSON.parse(res.text ?? "");
      },
    };
  }
  const res = await fetch(url, { headers });
  return { status: res.status, ok: res.ok, json: () => res.json() };
}
```

- [ ] **Step 3: テスト合格確認**

Run: `npm test`
Expected: 全件 PASS（旧 359 + 新 1）

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/src/selfUpdate/types.ts obsidian-plugin/src/selfUpdate/http.ts obsidian-plugin/src/__tests__/selfUpdate/http.test.ts
git commit -m "feat(plugin): 自己更新用 http ヘルパー追加 (Task1)"
```

---

### Task 2: updateChecker（Releases 確認・semver 比較）

**Files:**
- Create: `obsidian-plugin/src/selfUpdate/updateChecker.ts`
- Test: `obsidian-plugin/src/__tests__/selfUpdate/updateChecker.test.ts`

**Interfaces:**
- Consumes: Task 1 の `httpGet` / `ReleaseAsset` / `UpdateCheckResult`
- Produces: `RELEASES_LATEST_URL`、`stripVPrefix(tag: string): string`、`compareSemver(a: string, b: string): number`、`checkForUpdate(localVersion: string): Promise<UpdateCheckResult>`

- [ ] **Step 1: テストを書く（失敗確認）**

```ts
// obsidian-plugin/src/__tests__/selfUpdate/updateChecker.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { stripVPrefix, compareSemver, checkForUpdate } from "../../selfUpdate/updateChecker";

test("stripVPrefix: v プレフィックスを除去する", () => {
  assert.equal(stripVPrefix("v0.14.0"), "0.14.0");
  assert.equal(stripVPrefix("0.14.0"), "0.14.0");
});

test("compareSemver: 大小比較と同等判定", () => {
  assert.ok(compareSemver("0.14.0", "0.13.2") > 0);
  assert.ok(compareSemver("0.13.2", "0.14.0") < 0);
  assert.equal(compareSemver("0.13.2", "0.13.2"), 0);
  assert.ok(compareSemver("1.0.0", "0.99.99") > 0);
});

function mockFetch(body: unknown, status = 200): void {
  (globalThis as any).fetch = async () =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
}

test("checkForUpdate: 更新あり（リモートが新しい）", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v0.14.0",
        assets: [{ name: "main.js", browser_download_url: "https://example.com/main.js" }],
      }),
    }) as unknown as Response,
  );
  const r = await checkForUpdate("0.13.2");
  assert.equal(r.updateAvailable, true);
  assert.equal(r.tagName, "v0.14.0");
  assert.equal(r.assets[0].name, "main.js");
});

test("checkForUpdate: 同一バージョンなら更新なし・不完全 asset は除外", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v0.13.2",
        assets: [{ name: "main.js" }, { browser_download_url: "https://x" }],
      }),
    }) as unknown as Response,
  );
  const r = await checkForUpdate("0.13.2");
  assert.equal(r.updateAvailable, false);
  assert.equal(r.assets.length, 0);
});

test("checkForUpdate: 404 は明示的エラー", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response,
  );
  await assert.rejects(() => checkForUpdate("0.13.2"), /404/);
});

test("checkForUpdate: 403（レート制限）は明示的エラー", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response,
  );
  await assert.rejects(() => checkForUpdate("0.13.2"), /レート制限/);
});
```

Run: `npm test`
Expected: FAIL（updateChecker が存在しない）

- [ ] **Step 2: 実装**

```ts
// obsidian-plugin/src/selfUpdate/updateChecker.ts
// GitHub Releases の最新版を取得し、ローカルバージョンと比較する。
// Spec: docs/superpowers/specs/2026-09-04-self-update-design.md
import { httpGet } from "./http";
import type { ReleaseAsset, UpdateCheckResult } from "./types";

export const RELEASES_LATEST_URL =
  "https://api.github.com/repos/superlambkin/GijiObisdian/releases/latest";

const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "GijiObsidian-Plugin",
};

/** タグの `v` プレフィックスを除去 */
export function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/** semver 厳密比較（a<b:負 / a>b:正 / 同等:0）。Major.Minor.Patch のみ */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface GithubLatestRelease {
  tag_name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

export async function checkForUpdate(localVersion: string): Promise<UpdateCheckResult> {
  const res = await httpGet(RELEASES_LATEST_URL, GH_HEADERS);
  if (res.status === 404) throw new Error(`GitHub API 404: Release が見つかりません (${RELEASES_LATEST_URL})`);
  if (res.status === 403) throw new Error("GitHub API 403: レート制限です。1 時間後に再試行してください");
  if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`);
  const body = (await res.json()) as GithubLatestRelease;
  const tagName = body.tag_name ?? "";
  const assets: ReleaseAsset[] = (body.assets ?? [])
    .filter((a): a is { name: string; browser_download_url: string } =>
      typeof a.name === "string" && typeof a.browser_download_url === "string")
    .map((a) => ({ name: a.name, browser_download_url: a.browser_download_url }));
  return {
    updateAvailable: compareSemver(stripVPrefix(tagName), localVersion) > 0,
    tagName,
    assets,
  };
}
```

- [ ] **Step 3: テスト合格確認** — Run: `npm test` / Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/src/selfUpdate/updateChecker.ts obsidian-plugin/src/__tests__/selfUpdate/updateChecker.test.ts
git commit -m "feat(plugin): 更新チェッカー追加 (Task2)"
```

---

### Task 3: backupManager（バックアップ退避）

**Files:**
- Create: `obsidian-plugin/src/selfUpdate/backupManager.ts`
- Test: `obsidian-plugin/src/__tests__/selfUpdate/backupManager.test.ts`

**Interfaces:**
- Produces: `BACKUP_TARGET_FILES: readonly string[]`、`backupPluginFiles(pluginDir: string, adapter: DataAdapter, now?: Date): Promise<string>`（戻り値は退避先ディレクトリパス）

- [ ] **Step 1: テストを書く（失敗確認）**

```ts
// obsidian-plugin/src/__tests__/selfUpdate/backupManager.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { backupPluginFiles, BACKUP_TARGET_FILES } from "../../selfUpdate/backupManager";

/** DataAdapter のインメモリスタブ */
function makeAdapter(existing: string[] = []) {
  const files = new Map<string, ArrayBuffer>();
  for (const p of existing) files.set(p, new ArrayBuffer(1));
  return {
    files,
    async exists(p: string) { return files.has(p); },
    async mkdir(_p: string) { /* 記録省略 */ },
    async readBinary(p: string) { return files.get(p) ?? new ArrayBuffer(0); },
    async writeBinary(p: string, data: ArrayBuffer) { files.set(p, data); },
  };
}

const NOW = new Date("2026-09-04T12:34:56.789Z");

test("BACKUP_TARGET_FILES: 更新対象 5 ファイルを含む", () => {
  assert.deepEqual([...BACKUP_TARGET_FILES],
    ["main.js", "manifest.json", "styles.css", "worker.js", "ffmpeg-core.js"]);
});

test("backupPluginFiles: 存在するファイルのみ .backup/<UTC>/ へ退避する", async () => {
  const adapter = makeAdapter(["plugin/main.js", "plugin/manifest.json"]);
  const dir = await backupPluginFiles("plugin", adapter as any, NOW);
  assert.equal(dir, "plugin/.backup/2026-09-04T12-34-56Z");
  assert.ok(adapter.files.has("plugin/.backup/2026-09-04T12-34-56Z/main.js"));
  assert.ok(adapter.files.has("plugin/.backup/2026-09-04T12-34-56Z/manifest.json"));
  assert.ok(!adapter.files.has("plugin/.backup/2026-09-04T12-34-56Z/styles.css"));
});

test("backupPluginFiles: 同名ディレクトリ衝突時は -001 連番", async () => {
  const adapter = makeAdapter(["plugin/main.js", "plugin/.backup/2026-09-04T12-34-56Z/x"]);
  const dir = await backupPluginFiles("plugin", adapter as any, NOW);
  assert.equal(dir, "plugin/.backup/2026-09-04T12-34-56Z-001");
});
```

Run: `npm test` / Expected: FAIL

- [ ] **Step 2: 実装**

```ts
// obsidian-plugin/src/selfUpdate/backupManager.ts
// 更新前のプラグインファイルを <pluginDir>/.backup/<UTC-ISO>/ へ退避する。
import type { DataAdapter } from "obsidian";

export const BACKUP_TARGET_FILES = [
  "main.js",
  "manifest.json",
  "styles.css",
  "worker.js",
  "ffmpeg-core.js",
] as const;

/** Date を UTC-ISO 風のディレクトリ名へ（例: 2026-09-04T12-34-56Z） */
function toUtcDirName(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

/** 更新対象ファイルを退避し、退避先パスを返す（衝突時は -001 連番） */
export async function backupPluginFiles(
  pluginDir: string,
  adapter: DataAdapter,
  now: Date = new Date(),
): Promise<string> {
  const base = `${pluginDir}/.backup`;
  let dirName = toUtcDirName(now);
  for (let n = 0; await adapter.exists(`${base}/${dirName}`); n++) {
    dirName = `${toUtcDirName(now)}-${String(n + 1).padStart(3, "0")}`;
  }
  const backupDir = `${base}/${dirName}`;
  await adapter.mkdir(backupDir);
  for (const f of BACKUP_TARGET_FILES) {
    const src = `${pluginDir}/${f}`;
    if (await adapter.exists(src)) {
      await adapter.writeBinary(`${backupDir}/${f}`, await adapter.readBinary(src));
    }
  }
  return backupDir;
}
```

- [ ] **Step 3: テスト合格確認** — Run: `npm test` / Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/src/selfUpdate/backupManager.ts obsidian-plugin/src/__tests__/selfUpdate/backupManager.test.ts
git commit -m "feat(plugin): 更新前バックアップ追加 (Task3)"
```

---

### Task 4: updateDownloader と reloader

**Files:**
- Create: `obsidian-plugin/src/selfUpdate/updateDownloader.ts`
- Create: `obsidian-plugin/src/selfUpdate/reloader.ts`
- Test: `obsidian-plugin/src/__tests__/selfUpdate/updateDownloader.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ReleaseAsset`
- Produces: `downloadBinary(url: string): Promise<ArrayBuffer>`、`downloadAssets(assets: ReleaseAsset[], pluginDir: string, adapter: DataAdapter): Promise<void>`、`reloadPlugin(app: App, pluginId: string): Promise<void>`

- [ ] **Step 1: テストを書く（失敗確認）**

```ts
// obsidian-plugin/src/__tests__/selfUpdate/updateDownloader.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { downloadBinary, downloadAssets } from "../../selfUpdate/updateDownloader";

function makeAdapter() {
  const files = new Map<string, ArrayBuffer>();
  return {
    files,
    async writeBinary(p: string, d: ArrayBuffer) { files.set(p, d); },
  };
}

test("downloadBinary: fetch でバイナリ取得できる", async (t) => {
  const buf = new Uint8Array([1, 2, 3]).buffer;
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: true, status: 200, arrayBuffer: async () => buf }) as unknown as Response,
  );
  assert.equal(await downloadBinary("https://example.com/main.js"), buf);
});

test("downloadBinary: HTTP エラーは throw", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    ({ ok: false, status: 404 }) as unknown as Response,
  );
  await assert.rejects(() => downloadBinary("https://example.com/main.js"), /HTTP 404/);
});

test("downloadAssets: アセットを pluginDir へ書き込む・失敗時は名称付きエラー", async (t) => {
  const buf = new ArrayBuffer(4);
  t.mock.method(globalThis, "fetch", async (_url: string) => {
    if (String(_url).includes("bad")) return { ok: false, status: 500 } as unknown as Response;
    return { ok: true, status: 200, arrayBuffer: async () => buf } as unknown as Response;
  });
  const adapter = makeAdapter();
  await assert.rejects(
    () => downloadAssets(
      [{ name: "bad.js", browser_download_url: "https://example.com/bad" }],
      "plugin", adapter as any,
    ),
    /ダウンロード失敗: bad\.js/,
  );
  await downloadAssets(
    [{ name: "main.js", browser_download_url: "https://example.com/main.js" }],
    "plugin", adapter as any,
  );
  assert.ok(adapter.files.has("plugin/main.js"));
});
```

Run: `npm test` / Expected: FAIL

- [ ] **Step 2: 実装**

```ts
// obsidian-plugin/src/selfUpdate/updateDownloader.ts
// GitHub Release アセットをダウンロードし Vault プラグインフォルダへ上書きする。
import type { DataAdapter } from "obsidian";
import type { ReleaseAsset } from "./types";

/** バイナリ 1 件をダウンロード（Obsidian requestUrl / fetch フォールバック） */
export async function downloadBinary(url: string): Promise<ArrayBuffer> {
  try {
    const obs = require("obsidian") as { requestUrl?: (o: { url: string; method: string }) => Promise<{ status: number; arrayBuffer?: ArrayBuffer }> };
    if (typeof obs.requestUrl === "function") {
      const res = await obs.requestUrl({ url, method: "GET" });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`);
      return res.arrayBuffer ?? new ArrayBuffer(0);
    }
  } catch (e) {
    if (e instanceof Error && /HTTP \d+/.test(e.message)) throw e;
    /* obsidian 未解決環境は fetch へフォールバック */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.arrayBuffer();
}

/** アセットを順次ダウンロードして pluginDir へ上書き（1 件でも失敗すれば throw） */
export async function downloadAssets(
  assets: ReleaseAsset[],
  pluginDir: string,
  adapter: DataAdapter,
): Promise<void> {
  for (const asset of assets) {
    try {
      const data = await downloadBinary(asset.browser_download_url);
      await adapter.writeBinary(`${pluginDir}/${asset.name}`, data);
    } catch (e) {
      throw new Error(`ダウンロード失敗: ${asset.name} — ${(e as Error).message}`);
    }
  }
}
```

```ts
// obsidian-plugin/src/selfUpdate/reloader.ts
// プラグインを disable -> enable で再読込する。
import type { App } from "obsidian";

export async function reloadPlugin(app: App, pluginId: string): Promise<void> {
  const plugins = (app as unknown as {
    plugins?: {
      enablePlugin?: (id: string) => Promise<void>;
      disablePlugin?: (id: string) => Promise<void>;
    };
  }).plugins;
  await plugins?.disablePlugin?.(pluginId);
  await plugins?.enablePlugin?.(pluginId);
}
```

- [ ] **Step 3: テスト合格確認** — Run: `npm test` / Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/src/selfUpdate/updateDownloader.ts obsidian-plugin/src/selfUpdate/reloader.ts obsidian-plugin/src/__tests__/selfUpdate/updateDownloader.test.ts
git commit -m "feat(plugin): アセット DL とプラグイン再読込追加 (Task4)"
```

---

### Task 5: runSelfUpdate 統合フロー

**Files:**
- Create: `obsidian-plugin/src/selfUpdate/index.ts`
- Test: `obsidian-plugin/src/__tests__/selfUpdate/selfUpdateFlow.test.ts`

**Interfaces:**
- Consumes: Task 2〜4 の `checkForUpdate` / `backupPluginFiles` / `downloadAssets` / `reloadPlugin`
- Produces: `runSelfUpdate(app: App, pluginId: string, localVersion: string, pluginDir: string, adapter: DataAdapter, notice?: (msg: string) => void): Promise<void>`

- [ ] **Step 1: テストを書く（失敗確認）**

モジュール関数を差し替えて流れを検証する。`index.ts` は依存を毎回 `import` で束縛するため、テストでは `t.mock.method` でモジュールの export を差し替える（node:test の mock はオブジェクトプロパティを差し替えるため、`import * as mod` 形式で参照を保持する）。

```ts
// obsidian-plugin/src/__tests__/selfUpdate/selfUpdateFlow.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as checker from "../../selfUpdate/updateChecker";
import * as backup from "../../selfUpdate/backupManager";
import * as downloader from "../../selfUpdate/updateDownloader";
import * as reloader from "../../selfUpdate/reloader";
import { runSelfUpdate } from "../../selfUpdate/index";

const ADAPTER = {} as any;
const APP = {} as any;
const calls: string[] = [];

function installMocks(opts: {
  updateAvailable: boolean;
  failAt?: "backup" | "download" | "reload";
}) {
  t_mock(checker, "checkForUpdate", async () => {
    calls.push("check");
    return {
      updateAvailable: opts.updateAvailable,
      tagName: "v0.14.0",
      assets: [{ name: "main.js", browser_download_url: "https://x/main.js" }],
    };
  });
  t_mock(backup, "backupPluginFiles", async () => {
    if (opts.failAt === "backup") throw new Error("backup boom");
    calls.push("backup");
    return "plugin/.backup/x";
  });
  t_mock(downloader, "downloadAssets", async () => {
    if (opts.failAt === "download") throw new Error("dl boom");
    calls.push("download");
  });
  t_mock(reloader, "reloadPlugin", async () => {
    if (opts.failAt === "reload") throw new Error("reload boom");
    calls.push("reload");
  });
}

/** モジュール export を差し替えるヘルパー（終了時に自動復元） */
function t_mock(mod: Record<string, unknown>, name: string, impl: unknown) {
  const orig = mod[name];
  mod[name] = impl;
  process.on("exit", () => { mod[name] = orig; });
}

test("runSelfUpdate: 更新あり → backup→download→reload の順で実行", async () => {
  calls.length = 0;
  const notices: string[] = [];
  installMocks({ updateAvailable: true });
  await runSelfUpdate(APP, "GijiObsidian", "0.13.2", "plugin", ADAPTER, (m) => notices.push(m));
  assert.deepEqual(calls, ["check", "backup", "download", "reload"]);
  assert.ok(notices.some((m) => m.includes("v0.14.0") && m.includes("更新しました")));
});

test("runSelfUpdate: 最新版なら何もしない", async () => {
  calls.length = 0;
  const notices: string[] = [];
  installMocks({ updateAvailable: false });
  await runSelfUpdate(APP, "GijiObsidian", "0.14.0", "plugin", ADAPTER, (m) => notices.push(m));
  assert.deepEqual(calls, ["check"]);
  assert.ok(notices.some((m) => m.includes("最新版")));
});

test("runSelfUpdate: チェック失敗でエラー Notice", async () => {
  calls.length = 0;
  const notices: string[] = [];
  const orig = checker.checkForUpdate;
  checker.checkForUpdate = async () => { throw new Error("api down"); };
  try {
    await runSelfUpdate(APP, "GijiObsidian", "0.13.2", "plugin", ADAPTER, (m) => notices.push(m));
  } finally {
    checker.checkForUpdate = orig;
  }
  assert.deepEqual(calls, []);
  assert.ok(notices.some((m) => m.includes("api down")));
});

test("runSelfUpdate: DL 失敗時はバックアップ先を案内", async () => {
  const notices: string[] = [];
  installMocks({ updateAvailable: true, failAt: "download" });
  await runSelfUpdate(APP, "GijiObsidian", "0.13.2", "plugin", ADAPTER, (m) => notices.push(m));
  assert.ok(notices.some((m) => m.includes("plugin/.backup/x") && m.includes("dl boom")));
});
```

> 注: `t_mock` の自動復元は簡易。node:test の `t.mock.method(mod, name, impl)` が使える環境ならそちらを優先（`import * as mod` に対して使用可）。

Run: `npm test` / Expected: FAIL（index が存在しない）

- [ ] **Step 2: 実装**

```ts
// obsidian-plugin/src/selfUpdate/index.ts
// 更新フロー全体: チェック -> バックアップ -> DL -> リロード。
// UI からはこの関数だけを呼ぶ。
import { Notice } from "obsidian";
import type { App, DataAdapter } from "obsidian";
import { checkForUpdate } from "./updateChecker";
import { backupPluginFiles } from "./backupManager";
import { downloadAssets } from "./updateDownloader";
import { reloadPlugin } from "./reloader";

export async function runSelfUpdate(
  app: App,
  pluginId: string,
  localVersion: string,
  pluginDir: string,
  adapter: DataAdapter,
  notice: (msg: string) => void = (m) => new Notice(m),
): Promise<void> {
  const fail = (prefix: string, e: unknown): void => {
    notice(`❌ ${prefix}: ${(e as Error).message}`);
  };
  try {
    notice("🔄 更新を確認中...");
    const result = await checkForUpdate(localVersion);
    if (!result.updateAvailable) {
      notice(`✅ 最新版です (${result.tagName || `v${localVersion}`})`);
      return;
    }
    let backupPath: string;
    try {
      backupPath = await backupPluginFiles(pluginDir, adapter);
    } catch (e) {
      return fail("バックアップ失敗", e);
    }
    try {
      await downloadAssets(result.assets, pluginDir, adapter);
    } catch (e) {
      return fail(`${backupPath} から復元可 — ダウンロード失敗`, e);
    }
    try {
      await reloadPlugin(app, pluginId);
      notice(`✅ ${result.tagName} に更新しました`);
    } catch (e) {
      return fail("再読込失敗", e);
    }
  } catch (e) {
    return fail("更新確認失敗", e);
  }
}
```

- [ ] **Step 3: テスト合格確認** — Run: `npm test` / Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/src/selfUpdate/index.ts obsidian-plugin/src/__tests__/selfUpdate/selfUpdateFlow.test.ts
git commit -m "feat(plugin): 自己更新フロー統合 (Task5)"
```

---

### Task 6: 設定画面への更新ボタン追加

**Files:**
- Modify: `obsidian-plugin/src/settings.ts`（`display()` 内 `giji-version-info` パネル・v0.13.2 追加箇所の直後）
- Test: `obsidian-plugin/src/__tests__/settings.test.ts`（末尾に追記）

**Interfaces:**
- Consumes: Task 5 の `runSelfUpdate`、既存 `buildVersionInfoText`、`this.plugin.manifest.version` / `this.plugin.manifest.dir`、`this.app.vault.adapter.basePath`

- [ ] **Step 1: テストを書く（失敗確認）**

```ts
// obsidian-plugin/src/__tests__/settings.test.ts の末尾に追記
test("display(): バージョンパネルに更新確認ボタンが生成される", async () => {
  const { GijiSettingsTab } = await import("../settings");
  const tab = new GijiSettingsTab({} as any, {
    manifest: { version: "0.13.2", dir: ".obsidian/plugins/GijiObsidian" },
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: async () => {},
  });
  // containerEl スタブ（createEl/createDiv を最低限備える）
  const versionPanelChildren: any[] = [];
  const div = (cls?: string) => ({
    cls,
    style: { cssText: "" },
    children: versionPanelChildren,
    createEl(tag: string, opts?: any) {
      const el = { tag, text: opts?.text, children: [], createEl: div, addEventListener() {}, style: { cssText: "" } };
      (el as any).children && versionPanelChildren.push(el);
      return el;
    },
    createDiv(opts?: any) { return this.createEl("div", opts); },
    addEventListener() {},
  });
  (tab as any).containerEl = {
    empty() {},
    createEl: div,
    createDiv: div,
  };
  await tab.display();
  const buttons = versionPanelChildren.filter((c: any) => c.tag === "button");
  assert.ok(buttons.some((b: any) => String(b.text).includes("更新を確認")));
});
```

> 注: 実装時に `display()` の既存 containerEl スタブ要件（`empty` / `createEl` / `createDiv`）を壊さないこと。既存テストが通らなくなった場合はこのスタブを既存テストに合わせて調整する。

Run: `npm test` / Expected: FAIL（ボタンがまだない）

- [ ] **Step 2: 実装 — settings.ts を修正**

`src/settings.ts` 冒頭の import 群に追加:

```ts
import { runSelfUpdate } from "./selfUpdate";
```

`display()` 内の versionInfo パネル生成の末尾（`versionInfo.createEl("span", { text: version });` の直後）に追加:

```ts
    // v0.14.0: 更新確認ボタン（GitHub Releases の最新版と比較し、自動更新まで実行）
    const updateBtn = versionInfo.createEl("button", { text: "🔄 更新を確認" });
    updateBtn.style.cssText = "margin-left: 10px; font-size: 12px; cursor: pointer;";
    updateBtn.addEventListener("click", async () => {
      updateBtn.disabled = true;
      try {
        const pluginId = this.plugin.manifest?.id ?? "GijiObsidian";
        const basePath = (this.app.vault as { adapter: { basePath: string } }).adapter.basePath;
        const pluginDir = `${basePath}/.obsidian/plugins/${pluginId}`;
        await runSelfUpdate(this.app, pluginId, this.plugin.manifest?.version ?? "", pluginDir, this.app.vault.adapter);
      } finally {
        updateBtn.disabled = false;
      }
    });
```

- [ ] **Step 3: テスト合格確認** — Run: `npm test` / Expected: PASS（既存 settings.test.ts 含め全件）

- [ ] **Step 4: Commit**

```bash
git add obsidian-plugin/src/settings.ts obsidian-plugin/src/__tests__/settings.test.ts
git commit -m "feat(plugin): 設定画面に更新確認ボタン追加 (Task6)"
```

---

### Task 7: GitHub Actions リリースワークフロー

**Files:**
- Create: `.github/workflows/release.yml`（リポジトリルート基準）

**Interfaces:**
- Produces: タグ `v*` push → ビルド → GitHub Release に `main.js` / `manifest.json` / `styles.css` / `worker.js` / `ffmpeg-core.js` を添付

- [ ] **Step 1: ワークフローを作成**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: obsidian-plugin
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: obsidian-plugin/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Verify tag matches manifest version
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          VER=$(node -p "require('./package.json').version")
          if [ "$TAG" != "$VER" ]; then
            echo "タグ($TAG) と package.json のバージョン($VER) が不一致"; exit 1
          fi

      - name: Build
        run: node esbuild.config.mjs production

      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            main.js
            manifest.json
            styles.css
            worker.js
            ffmpeg-core.js
```

- [ ] **Step 2: ローカル検証**

Run: `ls obsidian-plugin/node_modules/.bin/esbuild && node -e "console.log(require('js-yaml') ? 'ok' : '')" 2>/dev/null || echo "yaml lint は省略（CI が初回検証）"`
Expected: esbuild が存在すること（ワークフローのビルドコマンドがローカルと同じことを確認）。YAML の構文は初回タグ push 時の CI で検証する旨を CHANGELOG に明記すること。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: タグ push で Release 生成ワークフロー追加 (Task7)"
```

---

### Task 8: バージョン v0.14.0 統一・CHANGELOG・Vault デプロイ

**Files:**
- Modify: `obsidian-plugin/manifest.json`（`version` → `0.14.0`）
- Modify: `obsidian-plugin/package.json`（`version` → `0.14.0`）
- Modify: `recorder-bridge/config.py`（`VERSION` → `"0.14.0"`）
- Modify: `obsidian-plugin/CHANGELOG.md`（先頭に v0.14.0 エントリ追加）

**Interfaces:** なし（ドキュメント・バージョン統一のみ）

- [ ] **Step 1: 4 箇所のバージョンを 0.14.0 に更新**

```bash
cd /d/AI-Agent/GijiObsidian
grep -n '"version"' obsidian-plugin/manifest.json obsidian-plugin/package.json
grep -n 'VERSION' recorder-bridge/config.py
```

上記 3 ファイルを `0.13.2` → `0.14.0` に編集する（Edit ツール使用・他のフィールドは触らない）。

- [ ] **Step 2: CHANGELOG.md にエントリ追加**

`obsidian-plugin/CHANGELOG.md` の先頭（既存最新エントリの上）に追記:

```markdown
## v0.14.0 (2026-09-04)

### 🚀 Added
- ⭐ 設定画面バージョンパネルに「🔄 更新を確認」ボタンを追加（GitHub Releases の最新版と比較）
- ⭐ 自己更新機能: 更新確認 → バックアップ（`.backup/<UTC>/`）→ アセット DL → プラグイン再読込を自動実行
- GitHub Actions リリースワークフロー新設（タグ `v*` push でビルド成果物を Release 添付）

### 🧪 Tests
- `src/__tests__/selfUpdate/` 新設（http / updateChecker / backupManager / updateDownloader / selfUpdateFlow）+ settings 更新ボタン表示テスト
- テスト件数: 359 → **XXX 件**（実行結果に合わせて記入）

### 📝 Notes
- リリースはタグ push（`v0.14.0`）で初回 CI 検証を行う
```

- [ ] **Step 3: 全テスト・ビルド検証**

```bash
cd /d/AI-Agent/GijiObsidian/obsidian-plugin && npm test && node esbuild.config.mjs production
```

Expected: 全テスト PASS・ビルド成功（テスト件数を Step 2 の XXX に反映）

- [ ] **Step 4: Vault へデプロイして実機確認（UAT）**

既存デプロイ方法（`D:\AI-Agent\_devtools\obsidian-deploy.mjs` があればそれ、なければ `main.js` / `manifest.json` / `styles.css` / `worker.js` / `ffmpeg-core.js` を Vault の `.obsidian/plugins/GijiObsidian/` へ手動コピー）でデプロイ。

実機確認項目:
1. 設定 → GijiObsidian → バージョンパネルに「🔄 更新を確認」ボタンが表示される
2. 押下 → Release 未公開の現状では「❌ 更新確認失敗: GitHub API 404...」の Notice が出る（= 正常動作）
3. 設定値が壊れないこと

- [ ] **Step 5: Commit + タグ push（リリース）**

```bash
cd /d/AI-Agent/GijiObsidian
git add obsidian-plugin/manifest.json obsidian-plugin/package.json recorder-bridge/config.py obsidian-plugin/CHANGELOG.md
git commit -m "feat(plugin): 自己更新機能 リリース (v0.14.0)"
git tag v0.14.0
git push origin master v0.14.0
```

Expected: GitHub Actions の Release ワークフローが起動し、緑になれば `v0.14.0` Release にアセット 5 件が添付される（`gh run list` または Actions 画面で確認）。以後、更新ボタンが実用動作する。

---

## タスク依存関係

```
Task1 → Task2 → Task5 → Task6
  └──→ Task3 ──┘
  └──→ Task4 ──┘
Task7（独立・いつでも可）
Task8（全タスク後・最終）
```
