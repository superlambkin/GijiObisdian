# GijiObsidian

> 📂 路径：obsidian-plugin/README.md
> 🎙️ Obsidian 内で会議音声を録音し、クラウド STT / LLM で構造化された議事録を生成するプラグインです。

---

## ✨ 主な機能

- 🎤 **音声録音**: Obsidian 内で直接 PCM / MP3 録音
- 📥 **音声インポート**: 既存の音声ファイルをノートにドラッグ＆ドロップ
- 📝 **自動文字起こし**: クラウド STT（OpenAI / Google / Groq / Qwen3-ASR / Whisper-small / **MyWhisper 本地**）に送信
- 🤖 **AI 要約**: LLM（OpenAI / Anthropic / Google / Groq / Ollama）で議事録を構造化
- ⚙️ **設定タブ UI**: STT / LLM / プロファイル切替を GUI で操作

---

## 🎯 対応 STT エンジン

| キー | 名称 | 種類 | 認証 | ネットワーク |
|------|------|------|------|--------------|
| `openai` | OpenAI Whisper API | クラウド | API Key | インターネット |
| `google` | Google Cloud Speech-to-Text | クラウド | API Key | インターネット |
| `groq` | Groq Whisper | クラウド | API Key | インターネット |
| `qwen3-asr` | Qwen3-ASR 本地 | LAN 自研 ASR | 不要（または Token） | LAN |
| `whisper-small` | Whisper-small 本地 | Python HTTP サーバ | 不要 | LAN |
| `mywhisper` | MyWhisper 本地 (POC_020) | LAN 自研 ASR | - | 无（:9000 无认证）|

---

## 🚀 インストール

1. Obsidian の `.obsidian/plugins/GijiObsidian/` フォルダに本プラグインを配置
2. `main.js` / `manifest.json` を配置
3. Obsidian の「コミュニティプラグイン」で **GijiObsidian** を有効化
4. 設定タブで STT / LLM の API キーを入力

---

## 📖 ドキュメント

- ユーザーマニュアル: [08_説明書/02_ユーザーマニュアル/機能詳細.md](08_説明書/02_ユーザーマニュアル/機能詳細.md)
- リリース履歴: [CHANGELOG.md](CHANGELOG.md)

---

## 📜 ライセンス

Private plugin — MiuMiu
