# Changelog

GijiObsidian 插件のすべての重要な変更は、このファイルに記録されます。

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
