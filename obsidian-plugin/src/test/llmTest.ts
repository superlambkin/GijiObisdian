import { GijiSettings } from "../settings";
import { createLlmProvider, getDefaultFetch } from "../providers/llm";
import { getPreset } from "../providers/llmPresets";

export interface LlmTestResult {
  ok: boolean;
  text?: string;
  error?: string;
}

async function testClaudian(app: any): Promise<LlmTestResult> {
  const p = app?.plugins?.plugins?.["realclaudian"];
  if (!p || typeof p.activateView !== "function" || typeof p.getView !== "function") {
    return { ok: false, error: "未检测到 realclaudian 插件（未安装或未启用）" };
  }
  try {
    await p.activateView();
    const view = p.getView();
    if (!view || typeof view.appendToActiveInput !== "function") {
      return { ok: false, error: "realclaudian 内部 API 不可用（升级后须 grep 复核）" };
    }
    return { ok: true, text: "Claudian 插件检测正常（未插入测试文本）" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function runLlmTest(
  settings: GijiSettings,
  app?: any,
  fetchImpl: typeof fetch = getDefaultFetch()
): Promise<LlmTestResult> {
  // claudian は API 呼び出しを行わない設計（既存 providers/llm.ts は throw）。
  // プラグイン検出のみで判定する。
  if (settings.llmProvider === "claudian") {
    return testClaudian(app);
  }
  const preset = getPreset(settings.llmProvider);
  if (!preset) return { ok: false, error: `未知の LLM プロバイダ: ${settings.llmProvider}` };
  if (!settings.llmBaseUrl.trim()) return { ok: false, error: "请先填写 LLM baseUrl" };
  if (!settings.llmModel.trim()) return { ok: false, error: "请先填写 LLM 模型" };
  if (preset.requiresApiKey && !settings.llmApiKey) {
    return { ok: false, error: "请先填写 LLM API Key" };
  }
  try {
    const llm = createLlmProvider(settings, fetchImpl);
    const text = await llm.complete("", "连接测试：请只回复「OK」");
    if (!text.trim()) return { ok: false, error: "请求成功但未返回文本" };
    return { ok: true, text: text.trim().slice(0, 30) };
  } catch (e: any) {
    // === UAT 失敗診断用：詳細スタックトレースを返す ===
    const parts: string[] = [];
    parts.push(`name=${e?.name ?? "?"}`);
    parts.push(`msg=${e?.message ?? String(e)}`);
    if (e?.code) parts.push(`code=${e.code}`);
    if (e?.cause) parts.push(`cause=${e.cause?.message ?? String(e.cause)}`);
    parts.push(`transport=${(fetchImpl as any)?.transportName ?? "custom"}`);
    const stack = e?.stack?.split("\n").slice(0, 5).join(" | ") ?? "";
    if (stack) parts.push(`stack=${stack}`);
    return { ok: false, error: parts.join("\n") };
  }
}