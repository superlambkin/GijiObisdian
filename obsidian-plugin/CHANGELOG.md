# Changelog

GijiObsidian 插件のすべての重要な変更は、このファイルに記録されます。

## [0.9.0] - 2026-08-28

### 🔧 ブリッジ録音を削除・ダイレクトのみ化

- 🗑️ **ブリッジ録音（recorder-bridge）を完全削除**：録音手法ドロップダウン、ブリッジ URL / ディレクトリ設定、ブリッジボタン、`bridge.ts` / `bridgeLauncher.ts` を撤去
- ✅ **録音手法は PC ダイレクト録音（`MediaRecorder`）のみ**
- 🎙️ **録音モード**：MIX（デフォルト）/ MIC / スピーカー を選択可能に維持
- ⚠️ ダイレクト録音では Obsidian（Electron）の制約により PC 音声（システム音）はキャプチャ不可（MIX 選択時はマイクのみで録音し警告を表示）

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
