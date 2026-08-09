/** 設定画面の 4 タブ（録音/文字起こし/要約/その他）用スタイル */
export const SETTINGS_TABS_CSS = `
.giji-settings-tabs {
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--background-modifier-border);
  margin-bottom: 12px;
}
.giji-settings-tab {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-s) var(--radius-s) 0 0;
  border-bottom: 2px solid transparent;
  font-size: var(--font-ui-small);
  font-family: inherit;
}
.giji-settings-tab:hover {
  color: var(--text-normal);
  background: var(--background-modifier-hover);
}
.giji-settings-tab.is-active {
  color: var(--text-accent);
  border-bottom-color: var(--interactive-accent);
  font-weight: var(--font-semibold);
}
`;

export function injectSettingsTabStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("giji-settings-tabs-styles")) return;
  const style = document.createElement("style");
  style.id = "giji-settings-tabs-styles";
  style.textContent = SETTINGS_TABS_CSS;
  document.head.appendChild(style);
}
