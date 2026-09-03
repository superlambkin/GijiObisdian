# GijiObsidian 自己更新機能 設計書

> 📂 パス: docs/superpowers/specs/2026-09-04-self-update-design.md
> 🏷️ 対象バージョン: v0.14.0
> 📅 作成日: 2026-09-04

---

## 1. 概要

ClaudianBridge v0.32.10 の自己更新機構（`docs/superpowers/specs/2026-09-03-self-update-design.md`）を参考に、GijiObsidian Obsidian プラグインに「更新確認 + 自動更新」ボタンを追加する。

- 更新確認ボタンを設定画面のバージョン情報パネルに追加
- GitHub Releases（`superlambkin/GijiObisdian`）を配布元とする完全自動更新
- リリース基盤として GitHub Actions ワークフローを新設

## 2. 背景・制約

| 項目 | 内容 |
|------|------|
| 参考実装 | ClaudianBridge `src/features/self-update/`（v0.32.10） |
| 配布元 | GitHub Releases API（`https://api.github.com/repos/superlambkin/GijiObisdian/releases/latest`） |
| 既存リリース基盤 | なし（`.github/workflows` 未整備・Releases 未公開）→ 本設計で新設 |
| ビルド成果物 | `main.js` / `manifest.json` / `styles.css` / `worker.js` / `ffmpeg-core.js` は git 未追跡 → Release アセットとして配布 |
| i18n | プロジェクト慣習に従い日本語ハードコード（i18n 機構なし） |

## 3. アーキテクチャ

```
obsidian-plugin/src/features/self-update/
├── update-checker.ts     # Releases/latest 取得・semver 比較
├── update-downloader.ts  # アセット DL（requestUrl, fetch フォールバック）
├── backup-manager.ts     # 更新対象ファイルのバックアップ
├── reloader.ts           # disablePlugin → enablePlugin による再読込
└── index.ts              # runSelfUpdate 統合フロー
```

### 3.1 update-checker.ts

- `GET https://api.github.com/repos/superlambkin/GijiObisdian/releases/latest`
  - ヘッダー: `Accept: application/vnd.github+json`、`User-Agent: GijiObsidian-Plugin`
- `tag_name` から `v` プレフィックスを除去（`stripVPrefix`）
- `compareSemver(local, remote)`: Major.Minor.Patch を数値比較し `updateAvailable` を判定
- 404 / 403（レート制限）は明示的なエラーとして返す

### 3.2 backup-manager.ts

- 対象ファイル: `main.js` / `manifest.json` / `styles.css` / `worker.js` / `ffmpeg-core.js`（存在するもののみ）
- 退避先: `<pluginDir>/.backup/<UTC-ISO>/`（衝突時は `-001` 連番）
- バックアップ失敗時は更新全体を中断する

### 3.3 update-downloader.ts

- Release の `assets[].browser_download_url` から全アセットを DL
- `obsidian.requestUrl` を使用（未解決環境では `fetch` にフォールバック）
- `adapter.writeBinary` で `pluginDir` へ上書き
- DL 失敗時はバックアップパスを案内するエラーを返す

### 3.4 reloader.ts

- `app.plugins.disablePlugin(id)` → `enablePlugin(id)` で再読込

### 3.5 index.ts（runSelfUpdate）

```
1. Notice「🔄 更新を確認中...」
2. checkForUpdate(localVersion)
   → 更新なし: Notice「✅ 最新版です (vX.Y.Z)」で終了
3. backupPluginFiles()
   → 失敗: エラー Notice で中断
4. downloadAssets()
   → 失敗: バックアップ場所を案内するエラー Notice
5. reloadPlugin()
6. Notice「✅ vX.Y.Z に更新しました」
```

## 4. UI

- 配置: `GijiSettingsTab.display()` 内のバージョン情報パネル（`giji-version-info` div）内に「🔄 更新を確認」ボタンを追加
- 処理中は `setButtonText` + `disabled = true` で二重実行を防止し、完了/失敗後に再有効化
- 既存ボタン（「🔄 デバイス一覧を更新」等）と同一のパターンを踏襲
- `pluginDir` は `app.vault.adapter.basePath` から `<basePath>/.obsidian/plugins/<pluginId>` を組み立てる

## 5. GitHub Actions リリース基盤（新設）

`.github/workflows/release.yml`:

- トリガー: タグ `v*` の push
- 処理: checkout → Node セットアップ → `obsidian-plugin` のビルド（esbuild）→ タグと一致するバージョン検証 → Release 作成 → アセット添付
- アセット: `main.js` / `manifest.json` / `styles.css` / `worker.js` / `ffmpeg-core.js`
- バージョン 4 箇所（manifest.json / package.json / recorder-bridge config.py / CHANGELOG）とタグの一致性を検証し、不一致時は fail させる

## 6. テスト

`obsidian-plugin/src/__tests__/self-update/` に node:test 形式で追加:

| テスト | 検証内容 |
|--------|---------|
| update-checker | `stripVPrefix`・`compareSemver` の境界（同版/上下/プレフィックスあり） |
| backup-manager | 対象ファイルの退避・連番衝突処理 |
| update-downloader | アセット DL・書き込み（モック） |
| self-update-flow | 更新ありで backup→DL→reload 実行 / 最新版なら何もしない / チェック失敗でエラー |

## 7. バージョン・文書運用

- バージョン: **v0.14.0** に引き上げ（manifest.json / package.json / recorder-bridge config.py `VERSION` / CHANGELOG.md の 4 箇所統一）
- CHANGELOG.md に `## v0.14.0` エントリ追加（Added / Tests セクション、テスト件数更新）
- コミットメッセージ: `feat(plugin): 自己更新機能（更新確認ボタン）追加 (v0.14.0)` 形式

## 8. スコープ外

- 自動・定期の更新チェック（起動時確認）— ボタン手動実行のみ
- recorder-bridge（Python 側）の更新 — プラグインのみ対象
- 更新チャネルの設定化（ベータ版など）— stable の Releases のみ対象
