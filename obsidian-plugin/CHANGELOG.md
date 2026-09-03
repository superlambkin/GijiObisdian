# Changelog

GijiObsidian 插件のすべての重要な変更は、このファイルに記録されます。

## v0.14.0 (2026-09-04)

### Added
- ⭐ **設定画面に「🔄 更新を確認」ボタン**：バージョン情報パネル（`giji-version-info`）内に追加。GitHub Releases（`superlambkin/GijiObisdian`）の最新版と semver 比較し、更新あれば自動更新まで実行
- ⭐ **自己更新機能**：更新確認 → バックアップ（`.backup/<UTC-ISO>/` に main.js / manifest.json / styles.css / worker.js / ffmpeg-core.js を退避）→ アセット DL（`requestUrl`・fetch フォールバック）→ プラグイン再読込（disable/enable）。処理中はボタン disabled で二重実行防止。ClaudianBridge v0.32.10 の実装を参考に移植
- 🏗️ **GitHub Actions リリースワークフロー新設**（`.github/workflows/release.yml`）：タグ `v*` push でテスト → タグ/バージョン一致検証 → ビルド → Release に 5 アセット添付

### Tests
- 新規 19 件: `src/__tests__/selfUpdate/`（http 1 / updateChecker 6 / backupManager 3 / updateDownloader 3 / selfUpdateFlow 4）+ settings `buildUpdateButton` 2 件
- 既存 359 件 + 新規 19 件 = **378 件すべて pass**

### Notes
- 設計書: `docs/superpowers/specs/2026-09-04-self-update-design.md` / 実装計画: `docs/superpowers/plans/2026-09-04-self-update.md`
- リリース運用: バージョン 4 箇所更新 → タグ push（例: `v0.14.0`）で CI が Release を自動作成

## v0.13.2 (2026-09-01)
### Added
- 🆕 **設定画面にバージョン情報パネル表示**：H2 見出し直下に `giji-version-info` パネルを追加。plugin バージョン（manifest.json 由来）を常時表示。`buildVersionInfoText()` ヘルパで 'v' プレフィックス付与・二重付与回避・undefined フォールバックを統一処理

### Changed
- 🔄 **バージョン完全統一**：`recorder-bridge/config.py` の `VERSION = "0.2.0"` → `"0.13.2"`。package.json / manifest.json / config.py / 設定画面表示の 4 箇所を同一バージョンに統一

### Tests
- 新規 3 件: `buildVersionInfoText`（プレフィックス付与 / undefined フォールバック / 二重付与回避）
- 既存 356 件 + 新規 3 件 = **359 件すべて pass**

## v0.13.1 (2026-09-01)
### Fixed
- 🐛 **PC WASAPI キャプチャの manifestDir 絶対パス解決（Electron cwd 問題）**：`Plugin.manifest.dir` は Electron 環境では相対パスを返し、Node プロセスの cwd は Obsidian バイナリの場所（`C:\...\Programs\Obsidian\`）になる。`pcLoopbackScriptDir` 未設定時のフォールバックで Python サブプロセスが `[Errno 2] No such file or directory` で即死していた問題を修正
- 🔧 `resolveAbsoluteScriptDir(app, scriptDir)` を新規追加：`app.vault.adapter.basePath`（Vault ルート）と結合して絶対パス化。既に絶対パスの場合は二重結合せずそのまま。basePath 不在時（モバイル等）は best-effort でそのまま返却
- 📍 修正は呼び出し側（`DirectRecorder.start`）で実施、`defaultSpawnPcLoopbackCapture` のロジックは変更なし

### Tests
- 新規 3 件: 相対 → 絶対パス変換 / 絶対パス優先 / basePath 不在時 best-effort
- 既存 353 件 + 新規 3 件 = **356 件すべて pass**

## v0.13.0 (2026-09-01)
### Fixed
- 🐛 **エンコード失敗時の Notice を format 対応に**：従来「⚠️ MP3 変換に失敗したため WAV で保存しました」と format に関わらず固定文言だったが、WAV 設定時に MP3 と誤表示／実態は WebM なのに WAV と誤表示の二重問題があった。`recordingFormat` と `audioPaths[0]` の拡張子から動的に「⚠️ {FORMAT} 変換に失敗したため {ACTUAL} のまま保存しました（ffmpeg を確認してください）」を生成
- 🔑 **warning キーを format 非依存に**：内部の `"mp3_encode_failed"` を `"encode_failed"` に変更（format と無関係な命名に統一）

### Added
- 🛠 **PC キャプチャ subprocess の診断ロガー（v0.13 真因究明用）**：`spawnPcLoopbackCapture` に `log` パラメータを追加。spawn 試行 / python パス / args / stdout / stderr / spawn error / exit code / stop タイムアウトを `<manifestDir>/logs/giji-YYYY-MM-DD.log` に記録。Electron 環境で Python 側クラッシュ（ImportError / soundcard 失敗等）が観測可能に
- 🌐 **PYTHONIOENCODING=utf-8 を subprocess env に追加**：Windows Python の stdout GBK/cp936 クラッシュを回避

### Tests
- 既存テスト 348 件 + 新規 5 件（`buildEncodeFailedNotice` 4 件 + encode_failed キーの format 非依存 2 件、警告キーの重複テスト 1 件を統合）= **353 件すべて pass**

## v0.12.1 (2026-08-31)
### Added
- 🆕 **録音ファイルの形式（WAV / MP3）を選択可能に**：設定画面「① 🎙️ 録音」タブに「録音ファイルの形式」ドロップダウンを追加
- 🎵 **MP3（64kbps・推奨）**：ファイルサイズが小さく、Whisper の文字起こし送信に最適（既存挙動・既定）
- 🎵 **WAV（16kHz・PCM・無圧縮）**：劣化なしで保存でき、音質重視・後段加工向け。ffmpeg で `-c:a pcm_s16le -ac 1 -ar 16000` を使用

### Implementation
- `GijiSettings.recordingFormat: "mp3" | "wav"` を追加（既定 `"mp3"`、既存ユーザー設定は後方互換）
- `DirectRecorder.stop()` が `settings.recordingFormat` に応じて出力パスと ffmpeg エンコーダを分岐（mic / pcLoopback / mix 全ケース対応）
- 既存テスト 341 件 + 新規 7 件 = 348 件すべて pass

## v0.12.0 (2026-08-31)
### Changed
- ブリッジ録音（recorder-bridge）を完全削除し、ダイレクト録音のみに統一
- PC 音声（TEAMS 含む）を WASAPI ループバック同梱スクリプトでキャプチャ
- MP3 変換をシステム ffmpeg CLI → wasm（@ffmpeg/ffmpeg）に統一
- 文字起こし既定を whisper-local → クラウド groq に変更
- sttServerDir / bridgeDir の D:\AI-Agent ハードコードを空文字に
- whisper-local は spawn 復活＋外部モデルフォルダ参照（sttWhisperModelDir）

## [0.11.0] - 2026-08-28

### 🎙️ PC ダイレクト録音で PC 音声（システム音）キャプチャ対応

- 🔧 **直接録音（ダイレクト録音）でも PC 音声を録音可能に**：`getDisplayMedia`（画面共有）が使えない Obsidian（Electron）環境では、
  **WASAPI ループバック**（`pc_loopback_capture.py` サブプロセス）で PC 音声を取得し、マイクとミックスして録音
- 🆕 録音モード `mix`（マイク + PC 音声）/ `pcLoopback`（PC 音声のみ）が**ダイレクト録音でも動作**
- 🔄 停止時に ffmpeg で マイク(webm) + PC(wav) を `amix` ミックス → MP3 64kbps → 文字起こし
- 📌 `getDisplayMedia` が使える環境では従来どおり画面共有方式を優先、不可なら WASAPI に自動フォールバック
- ⚠️ PC 音声キャプチャには `recorder-bridge` の Python 環境が必要（`bridgeDir` 設定。venv を自動利用）

## [0.10.0] - 2026-08-28

### 🔄 ブリッジ録音を復活（v0.9.0 の削除を巻き戻し）

- 🔄 **ブリッジ録音（recorder-bridge / WASAPI ループバック）を復活**：録音手法ドロップダウン、ブリッジ URL / ディレクトリ設定、ブリッジボタン、`bridge.ts` / `bridgeLauncher.ts` を再導入
- 🎙️ **録音手法**: ブリッジ録音（PC 音声対応） / PC ダイレクト録音 を選択可能
- ✅ 会議音声（PC 音声）を録音するには**ブリッジ録音**を選択（ダイレクト録音では Obsidian の制約により PC 音声を取得できないため）
- 📌 v0.9.0（ブリッジ削除）は取り消し：`git revert` 相当で v0.8.7 のブリッジ搭載状態へ復元

## [0.8.0] - 2026-08-25

### 🎙️ STT プロバイダ再設計

- 🗑️ **Qwen3-ASR を完全削除**（コード・設計書・テストすべて）
- 🆕 **Whisper ローカル拡張**：tiny / small / medium のモデル選択対応
- 🆕 **モデル DL 機能**：HuggingFace から自動 DL + 状態可視化
- 🆕 **モデル保存先指定**：既定 `<vault>/.obsidian/plugins/giji-obsidian/Model/`
- 🆕 **「📂 フォルダを開く」ボタン**：Explorer でモデル保存先を表示
- 🆕 **接続テスト日本語サンプル追加**
- ✅ **MyWhisper（POC_020）既存維持**
- ✅ **クラウド STT（openai / google / groq）既存維持**

## [0.7.0] - 2026-08-24

### ✨ 新增功能
- **MyWhisper 本地 STT Provider (POC_020)**: 新增 `mywhisper` 选项，调用主人 LAN 上 MyWhisper 服务的 `POST /asr` 端点（multipart, field=`audio_file`, 返回 raw text）
- 默认 Base URL 预填 `http://192.168.0.88:9000/`，选择后即可使用
- 可选 Bearer Token 字段（:9000 默认无认证，未来扩展预留）
- 防御式 3 段階响应検証 + `MyWhisperError`，LAN 服务异常的报错可读

### 🔧 改善
- 新增 14 件单元测试覆盖正常 / 错误 / 边界场景

## [0.6.0] - 2026-08-21

### ✨ 主要功能
- 录制 / 导入命令 + 设置页面 UI
- 录音方法选择（PCM / MP3）
- 录音时间状态栏
- 自动汇总 + 日语通知
- LLM 连接测试功能
- 设置菜单一键转写音频文件

### 🔧 改善
- FFmpeg Worker Blob URL 适配 Obsidian CSP
- esbuild post-build patch 保留 `import_meta`
- 音频转码结构化日志
