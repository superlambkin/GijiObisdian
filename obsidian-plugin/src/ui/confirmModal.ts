import { App, Modal, Setting } from "obsidian";

/** 上書き確認モーダルの文言（設計書 §7。テスト可能な純粋関数） */
export function buildOverwriteMessage(path: string): { title: string; body: string[] } {
  return {
    title: "議事録の上書き確認",
    body: [
      `既存の議事録が見つかりました：${path}`,
      "上書きしますか？（手動編集は失われます）",
    ],
  };
}

/**
 * 既存議事録の上書き確認モーダル。
 * true=上書き実行 / false=キャンセル（Esc・× ボタンでの終了も false）
 */
export function confirmOverwrite(app: App, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const modal = new (class extends Modal {
      onOpen(): void {
        const msg = buildOverwriteMessage(path);
        this.contentEl.createEl("h2", { text: msg.title });
        for (const line of msg.body) this.contentEl.createEl("p", { text: line });
        new Setting(this.contentEl)
          .addButton((b) =>
            b.setButtonText("上書きする").setCta().onClick(() => {
              if (!settled) { settled = true; resolve(true); }
              this.close();
            })
          )
          .addButton((b) =>
            b.setButtonText("キャンセル").onClick(() => {
              if (!settled) { settled = true; resolve(false); }
              this.close();
            })
          );
      }
      onClose(): void {
        this.contentEl.empty();
        if (!settled) { settled = true; resolve(false); }
      }
    })(app);
    modal.open();
  });
}
