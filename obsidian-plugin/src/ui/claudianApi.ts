// realclaudian 内部 API 経由でチャット入力欄へテキスト挿入する。
// DOM セレクタ推測はビュー再レンダリングで崩れるため、内部 API を優先利用する。
// 実績パターン: claudian-selection-bridge の addTextToClaudian（UAT 9/9 通過）
// 注意: realclaudian 更新後は appendToActiveInput/activateView/getView の存在を grep で再確認すること。

interface ClaudianLikeView {
  appendToActiveInput?: (text: string) => boolean;
}

interface ClaudianLikePlugin {
  activateView?: () => Promise<void> | void;
  getView?: () => ClaudianLikeView | null;
}

export async function appendToClaudianInput(app: any, text: string): Promise<boolean> {
  const p: ClaudianLikePlugin | undefined = app?.plugins?.plugins?.["realclaudian"];
  if (!p || typeof p.activateView !== "function" || typeof p.getView !== "function") {
    return false;
  }
  try {
    await p.activateView();
    const view = p.getView();
    if (!view || typeof view.appendToActiveInput !== "function") return false;
    return view.appendToActiveInput(text) === true;
  } catch {
    return false;
  }
}
