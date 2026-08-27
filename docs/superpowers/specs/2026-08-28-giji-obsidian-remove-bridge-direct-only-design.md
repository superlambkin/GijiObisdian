# GijiObsidian ブリッジ削除・ダイレクトのみ化 設計書

> 📂 パス：`docs/superpowers/specs/2026-08-28-giji-obsidian-remove-bridge-direct-only-design.md`
> 📍 対象：`D:\AI-Agent\giji-obsidian\obsidian-plugin`（v0.8.7 → **v0.9.0**）
> 日付：2026-08-28

---

## 1. 背景（問題）

### 1.1 発端

主人から以下の不具合報告：

> GigiObsidian で録音開始すると、アラームメッセージが表示されます。PC 音声が録音できません。画面の共有取得失敗

### 1.2 調査で判明した根本原因

- 直接録音モード（`recordingMethod=direct`）の `mix` / `pcLoopback` は
  `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`（画面共有）で PC 音声を取得する実装（v0.8.6/0.8.7）。
- **Obsidian（Electron）は `session.setDisplayMediaRequestHandler` を実装していない**ため、
  `getDisplayMedia()` は必ず `NotSupportedError: Not supported` で失敗する。
  - Obsidian 本体 `app.asar` に `setDisplayMediaRequestHandler` が存在しないことを確認済み。
  - Electron 仕様上、ハンドラ未設定時は `getDisplayMedia()` が `NotSupportedError: Not supported` を投げる
    （参考: [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) /
    [Sentry Electron docs](https://docs.sentry.io/platforms/javascript/guides/electron/user-feedback/)）。
- ログ `logs/giji-2026-08-27.log` に証拠：
  - `stage=getusermedia mode=direct audio_source=mix ... status=fail error="Not supported"`
  - フォールバック後は mic のみで `status=ok` になるが、PC 音声は入らないため
    `stage=stt ... error="MyWhisper 返回空文本（音频可能无语音或静音过长）"` が多発。

### 1.3 PC 音声を取る正しい方法（旧ブリッジ）

- ブリッジ録音（`recorder-bridge`）は `soundcard` の WASAPI ループバックで PC 音声を確実に取得できる。
- ただし本設計では**ブリッジを削除**するため、プラグイン単体では PC 音声キャプチャは不可となる
  （Obsidian の制約。主人の判断）。

---

## 2. ゴール

プラグインから**ブリッジ録音を完全に削除**し、録音手法を**ダイレクトのみ**に固定する。

- 録音手法ドロップダウンを撤去（常にダイレクト）。
- ブリッジ関連コード・設定・UI・テストを削除。
- `recorder-bridge`（Python）プロジェクトはディスク上に**残す**（削除しない）。
- 録音モード（audioSource）は **MIX（デフォルト）/ MIC / スピーカー（PC 音声のみ）** を維持。
- スピーカーデバイスドロップダウンは選択可能のまま維持。
- MIX 選択時の「PC 音声は録音できません…マイクのみで録音します」警告は**残す**（主人の決定）。

---

## 3. 要件（ユーザー決定事項）

| # | 項目 | 決定 |
|---|---|---|
| 1 | 録音手法 | ブリッジを完全削除、ダイレクトのみ |
| 2 | 削除範囲 | プラグインから完全削除（UI・コード・設定・テスト） |
| 3 | 録音手法ドロップダウン | 撤去（常にダイレクト） |
| 4 | 録音モード（audioSource） | MIX（デフォルト）/ MIC / スピーカー を選択可能に維持 |
| 5 | スピーカーデバイス | 選択可能に維持（direct ではキャプチャ制御に使われない旨を説明文に明記） |
| 6 | MIX で PC 音声が取れない時 | 警告を残す（「マイクのみで録音します」を通知） |
| 7 | recorder-bridge | 削除しない（ディスク上に残す） |

---

## 4. 変更内容

### 4.1 削除ファイル

| ファイル | 内容 |
|---|---|
| `src/bridge.ts` | `bridgeHealth` / `bridgeListDevices` / `bridgeStart` / `bridgeStop` |
| `src/bridgeLauncher.ts` | `isBridgeUp` / `launchBridge` |
| `src/__tests__/bridgeLauncher.test.ts` | 上記のテスト |

### 4.2 `src/settings.ts`

- 型 `RecordingMethodId` を削除。
- `GijiSettings` から以下を削除：
  - `recordingMethod`
  - `bridgeBaseUrl` / `bridgeDir`
  - `bridgeMicDeviceId` / `bridgeSpeakerDeviceId`
- `DEFAULT_SETTINGS` から上記を削除。
- 関数 `isBridgeSettingDisabled()` を削除。
- 設定 UI：
  - 「🎙️ 録音手法」ドロップダウンを撤去。
  - 「🔗 ブリッジ URL」「ブリッジのディレクトリ」欄を撤去。
  - `refreshAudioModeOptions()` / `updateBridgeDisabled()` の bridge 分岐を削除（常時全オプション表示）。
  - 録音モード（audioSource）ドロップダウンは **MIX / MIC / スピーカー** を維持。
    - **option の値（`value`）は変更しない**: `mix` / `mic` / `pcLoopback`（directRecorder.ts が参照）
    - 表示ラベル（`label`）のみ変更:
      - `mix` → `マイク + PC 音声`（デフォルト）
      - `mic` → `マイクのみ`
      - `pcLoopback` → `スピーカー（PC 音声のみ）`
    - 説明文から「WASAPI ループバック」「画面共有ダイアログ」表記を見直す。
  - マイク／スピーカードロップダウンは `directMicDeviceId` / `directSpeakerDeviceId` のみ操作。
  - スピーカードロップダウンの説明文：
    `ダイレクト録音ではスピーカーはキャプチャ制御に使われません（設定保持のみ）`。

### 4.3 `src/audio/recorder.ts`

- import から `bridgeHealth` / `bridgeStart` / `bridgeStop` を削除。
- `SegmentRecorder.sessionId` フィールドを削除。
- `start()`：
  - bridge 分岐を削除し、常に `this.direct.start(settings)` を実行。
  - `device_select mode=direct` のデバッグログを維持。
- `stop()`：
  - bridge セッション処理を削除し、常に `this.direct.stop(settings)` → `transcribePaths()`。

### 4.4 `src/audio/directRecorder.ts`

- **変更なし**（MIX / pcLoopback の getDisplayMedia 試行とマイクフォールバック警告を維持）。
- 既存の未コミット v0.8.6/0.8.7 実装はそのまま残す。

### 4.5 `src/audio/deviceList.ts`

- `DeviceListResult.source` から `"bridge"` を削除（`"direct" | "none"` のみ）。
- `listDevices()` から bridge フェッチ分岐を削除し、常に `navigator.mediaDevices.enumerateDevices()` を使用。
- `DeviceListFetcher.bridgeFetch` / `defaultBridgeFetch` を削除。

### 4.6 `src/ui/claudianButton.ts`

- import `isBridgeUp` / `launchBridge` を削除。
- `shouldShowBridgeButton()` / `makeBridgeButton()` / `refreshBridgeButtons()` / `updateBridgeButton()` を削除。
- ツールバー構築からブリッジボタン挿入・状態更新を削除。

### 4.7 テスト

| ファイル | 対応 |
|---|---|
| `src/__tests__/bridgeLauncher.test.ts` | **削除** |
| `src/__tests__/recorder.test.ts` | `bridgeStart` テスト（3 件）と `recordingMethod` 分岐テストを削除 |
| `src/__tests__/settings.test.ts` | bridge 設定のアサーションを削除 |
| `src/__tests__/deviceList.test.ts` | bridge フェッチテストを削除 |
| `src/__tests__/claudianButton.test.ts` | ブリッジボタンテストを削除 |
| `src/__tests__/directRecorder.test.ts` | 変更不要（mix フォールバックテストは維持） |

### 4.8 バージョン・ビルド・デプロイ

- `package.json` / `manifest.json`：`0.8.7` → **`0.9.0`**
- `CHANGELOG.md` に v0.9.0 エントリ追記。
- `npm run build` → `main.js` / `manifest.json` を Vault へデプロイ
  （`C:\Users\superlambkin\OneDrive\Edge\Obsidian Vault\.obsidian\plugins\giji-obsidian\`）。

---

## 5. データフロー（変更後）

```
録音開始 (startSegment)
  └─ SegmentRecorder.start(settings)
       └─ DirectRecorder.start(settings)
            ├─ audioSource=mix: getUserMedia(mic) + getDisplayMedia(PC音声)
            │    └─ getDisplayMedia 失敗 → ⚠️ 警告 → mic のみで録音
            ├─ audioSource=mic: getUserMedia(mic) のみ
            └─ audioSource=pcLoopback: getDisplayMedia のみ（失敗時は全体失敗）
       └─ MediaRecorder → webm → ffmpeg → MP3

録音停止 (stopSegment)
  └─ SegmentRecorder.stop(settings)
       └─ DirectRecorder.stop(settings) → MP3 パス
       └─ transcribePaths() → STT → テキスト化 → ノート追記 → 要約
```

---

## 6. エラーハンドリング

- `audioSource=mix` で `getDisplayMedia` 失敗 → `Notice("⚠️ PC 音声は録音できません（…）。マイクのみで録音します")`（既存維持）
- `audioSource=pcLoopback` で `getDisplayMedia` 失敗 → `Notice("⚠️ 録音デバイスにアクセスできません: …")`（既存維持）
- デバッグログ `stage=getusermedia mode=direct ...` は維持。

---

## 7. テスト戦略

- 既存テストから bridge 参照を除去し、**全テスト PASS** を確認：
  `cd obsidian-plugin && npm test`
- 新規テストは不要（挙動変更は削除のみ）。
- 手動 UAT（主人）：
  1. 設定画面に「録音手法」「ブリッジ URL」「ブリッジのディレクトリ」が無いこと
  2. 録音モードに MIX / MIC / スピーカー が表示されること
  3. MIX 録音開始 → 「PC 音声は録音できません…」警告 → マイク録音が動作すること
  4. MIC 録音開始 → 警告なしでマイク録音が動作すること

---

## 8. スコープ外（今回はやらない）

- `recorder-bridge`（Python）の削除・改修
- ダイレクト録音で PC 音声を取得する代替手段の実装（desktopCapturer 等）
- 既存未コミット v0.8.6/0.8.7 の directRecorder 実装の見直し

---

## 9. 参照文献

| # | 種別 | 参照元 |
|:--:|:----:|------|
| 1 | Web | https://www.electronjs.org/docs/latest/api/desktop-capturer |
| 2 | Web | https://docs.sentry.io/platforms/javascript/guides/electron/user-feedback/ |
| 3 | Vault MD | 調査ログ `.obsidian/plugins/giji-obsidian/logs/giji-2026-08-27.log` |
