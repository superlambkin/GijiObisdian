# qwen3-asr-server

ローカル ONNX-CPU の ASR（音声認識）サーバ。OpenAI 互換の
`POST /v1/audio/transcriptions` を公開し、GijiObsidian プラグインの
STT プロバイダー「Qwen3-ASR（ローカル）」から利用します。

- モデル: [Daumee/Qwen3-ASR-0.6B-ONNX-CPU](https://huggingface.co/Daumee/Qwen3-ASR-0.6B-ONNX-CPU)（既定）＋ **openai-whisper small**（`model=whisper-small` で切替）
- 推論: ONNX Runtime CPU / whisper（CPU torch。GPU 不要・API キー不要）
- ポート: `http://127.0.0.1:9000`

---

## 必要環境

| 項目 | 要件 |
|------|------|
| OS | Windows 10/11（想定。他 OS は手動起動で可） |
| Python | 3.10 以上（venv は Python 3.13/3.14 で実績あり） |
| Git | `model/` を Hugging Face からクローンするために必要 |
| ディスク空き | モデル本体が約 **4.9 GB** 必要 |

---

## インストール手順（初回のみ）

> ⚠️ モデルは `.gitignore` に登録されているため、リポジトリをクローンしただけでは
> `model/` が空です。必ず下記でダウンロードしてください。

### 1. モデルをダウンロード

`qwen3-asr-server/` 内で Hugging Face リポジトリを `model/` にクローンします。

```bash
cd /d/AI-Agent/giji-obsidian/qwen3-asr-server
git clone https://huggingface.co/Daumee/Qwen3-ASR-0.6B-ONNX-CPU ./model
```

**ダウンロード容量: 約 4.9 GB**（`onnx_models/` に量子化済み ONNX を含む）。回線により数分〜十数分かかります。

### 2. 仮想環境を作成

```bash
cd /d/AI-Agent/giji-obsidian/qwen3-asr-server
python -m venv .venv
```

### 3. 依存パッケージをインストール

```bash
source .venv/Scripts/activate
pip install -r requirements.txt
```

必要ならテスト用に `pip install pytest` も入れてください。

### 4. whisper-small を利用する場合（任意）

`model=whisper-small` で openai-whisper small エンジンを利用できます。
CPU 版 torch + openai-whisper の導入容量は約 **2 GB** です（初回は明示導入が必要）。

```bash
source .venv/Scripts/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install openai-whisper
```

> 💡 whisper のモデルは **初回 transcribe 時に自動ダウンロード**（約 460 MB）され、以後キャッシュされます。
> whisper 未導入の環境では `model=whisper-small` を指定すると 500 エラーになります。

---

## 起動方法

### 方法 A（推奨）: `start_qwen3_asr.bat` をダブルクリック

`qwen3-asr-server/start_qwen3_asr.bat` を実行すると、自動で
`.venv` を有効化して `python main.py` を起動します。

スクリプト内で `set PYTHONIOENCODING=utf-8` を設定済みです
（Windows コンソールの既定エンコーディングで日本語出力が
`UnicodeEncodeError` になるのを防ぐため）。

### 方法 B: 手動で起動

```bash
cd /d/AI-Agent/giji-obsidian/qwen3-asr-server
source .venv/Scripts/activate
export PYTHONIOENCODING=utf-8
python main.py
```

> 💡 **PYTHONIOENCODING=utf-8 について**: Windows の Python は既定で
> コンソールのコードページ（cp936/cp1252 等）で標準出力をエンコードします。
> サーバログやエラーに日本語が含まれると `UnicodeEncodeError` で落ちる場合があるため、
> `PYTHONIOENCODING=utf-8` を必ず設定してください。`start_qwen3_asr.bat` は設定済みです。

### 起動確認

モデルロードに **数秒〜十数秒** かかります（embedding 622 MB を含む）。
以下のログが出れば起動完了です。

```
INFO:     Uvicorn running on http://127.0.0.1:9000
```

> ポートを変えたい場合: 環境変数 `QWEN3_ASR_PORT` を設定してください
> （例: `set QWEN3_ASR_PORT=9100`）。既定は `9000`。

---

## エンドポイント仕様

### `POST http://127.0.0.1:9000/v1/audio/transcriptions`

OpenAI の Whisper API と互換の multipart/form-data を受け取ります。

| フィールド | 型 | 必須 | 説明 |
|-----------|-----|:---:|------|
| `file` | バイナリ | ✅ | 音声ファイル（WAV / MP3 等）。`audio.wav` / `audio.mp3` のファイル名を推奨 |
| `model` | 文字列 | 任意 | モデル名。`qwen3-asr-0.6b`（既定）/ `whisper-small`。未指定なら既定の Qwen3-ASR で動作 |
| `language` | 文字列 | 任意 | `Chinese` / `Japanese` / `English`。省略で自動検出 |

**成功レスポンス（200）**:

```json
{ "text": "こんにちは。これはテストです。" }
```

**失敗レスポンス（500）**: 音声ファイルが不正な場合など

```json
{ "detail": "..." }
```

### curl での動作確認

```bash
curl -s -X POST http://127.0.0.1:9000/v1/audio/transcriptions \
  -F "file=@test.wav" \
  -F "model=qwen3-asr-0.6b" \
  -F "language=Japanese"
```

---

## モデル切替（Qwen3-ASR / Whisper-small）

`POST /v1/audio/transcriptions` の `model` フィールドでエンジンを切替：

| model | エンジン | 備考 |
|-------|---------|------|
| `qwen3-asr-0.6b` | Qwen3-ASR（ONNX-CPU） | 既定・議事録向け |
| `whisper-small` | openai-whisper small（CPU torch） | 速度優先・下書き向け |

Whisper を使うには追加で `openai-whisper` と CPU 版 torch（~2GB）の導入が必要。
初回転写時は whisper-small モデル（~460MB）を自動ダウンロードする。

---

## プラグイン側の設定

GijiObsidian の設定 → ② 文字起こし → STT プロバイダーで
「Qwen3-ASR（ローカル）」を選択します。

| 設定 | 既定値 |
|------|--------|
| ASR サーバ URL | `http://127.0.0.1:9000/v1` |
| ASR モデル名 | `qwen3-asr-0.6b` |

「🧪 テスト転写」ボタンで、サーバ未起動の場合は接続エラーが、
起動済みなら認識テキストが Notice に表示されます。

---

## 注意事項

- **CORS**: `app://obsidian.md` / `http://localhost` / `http://127.0.0.1` のみ許可。
  Obsidian 以外のオリジンからは CORS で弾かれます（想定どおり）。
- **モデルロード時間**: 初回リクエスト時ではなくサーバ起動時にモデルをロードするため、
  起動が数秒〜十数秒ブロックされます。
- **認識品質**: ONNX-CPU の 0.6B モデルのため、長い音声や雑音の多い音声では
  部分認識になる場合があります。

---

*🎙️ qwen3-asr-server v0.1.0 · POC_016 GijiObsidian · 2026-08-10*
