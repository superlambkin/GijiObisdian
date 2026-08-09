import { GijiSettings, LlmApiFormat } from "../settings";

/**
 * provider 別に保存する LLM 設定プロファイル。
 * 接続テスト成功時・プリセット切替時に saveProviderProfile / switchLlmProvider で
 * 記録し、同じ provider に戻したときに読み出す（API キー・モデル名・URL を共有しない）。
 */
export interface LlmProviderProfile {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiFormat?: LlmApiFormat;
  anthropicVersion?: string;
  llmMaxTokens?: number;
  llmTimeoutMs?: number;
  llmMaxRetries?: number;
  llmApiFormatOverride?: boolean;
}

/** 現在の LLM 関連設定を providerId のプロファイルとして保存した新しい settings を返す */
export function saveProviderProfile(settings: GijiSettings, providerId: string): GijiSettings {
  const profile: LlmProviderProfile = {
    llmApiKey: settings.llmApiKey,
    llmBaseUrl: settings.llmBaseUrl,
    llmModel: settings.llmModel,
    llmApiFormat: settings.llmApiFormat,
    anthropicVersion: settings.anthropicVersion,
    llmMaxTokens: settings.llmMaxTokens,
    llmTimeoutMs: settings.llmTimeoutMs,
    llmMaxRetries: settings.llmMaxRetries,
    llmApiFormatOverride: settings.llmApiFormatOverride,
  };
  return {
    ...settings,
    llmProviderProfiles: {
      ...(settings.llmProviderProfiles ?? {}),
      [providerId]: profile,
    },
  };
}

/** providerId の保存済みプロファイルを現在の設定に反映した新しい settings を返す（無ければ無変更） */
export function loadProviderProfile(settings: GijiSettings, providerId: string): GijiSettings {
  const profile = settings.llmProviderProfiles?.[providerId];
  if (!profile) return settings;
  return {
    ...settings,
    ...(profile.llmApiKey !== undefined ? { llmApiKey: profile.llmApiKey } : {}),
    ...(profile.llmBaseUrl !== undefined ? { llmBaseUrl: profile.llmBaseUrl } : {}),
    ...(profile.llmModel !== undefined ? { llmModel: profile.llmModel } : {}),
    ...(profile.llmApiFormat !== undefined ? { llmApiFormat: profile.llmApiFormat } : {}),
    ...(profile.anthropicVersion !== undefined ? { anthropicVersion: profile.anthropicVersion } : {}),
    ...(profile.llmMaxTokens !== undefined ? { llmMaxTokens: profile.llmMaxTokens } : {}),
    ...(profile.llmTimeoutMs !== undefined ? { llmTimeoutMs: profile.llmTimeoutMs } : {}),
    ...(profile.llmMaxRetries !== undefined ? { llmMaxRetries: profile.llmMaxRetries } : {}),
    ...(profile.llmApiFormatOverride !== undefined ? { llmApiFormatOverride: profile.llmApiFormatOverride } : {}),
  };
}

/**
 * プリセット切替ヘルパ:
 * 1. 旧 provider の現在設定をプロファイルに保存
 * 2. 新 provider のプリセット既定を適用
 * 3. 新 provider の保存済みプロファイルを読み出す
 * 4. 保存済みプロファイルが無ければ API キーを引き継がない（旧 provider のキー残留を防ぐ）
 */
export function switchLlmProvider(settings: GijiSettings, newProviderId: LlmPresetId): GijiSettings {
  let next = saveProviderProfile(settings, settings.llmProvider);
  next = applyPreset(next, newProviderId);
  next = loadProviderProfile(next, newProviderId);
  if (!next.llmProviderProfiles?.[newProviderId]) {
    next = { ...next, llmApiKey: "" };
  }
  return next;
}

/**
 * LLM プロバイダ・プリセット ID。
 * 後方互換のため旧 ID（claudian / cloud / ollama）も含む。
 */
export type LlmPresetId =
  | "claudian"
  | "cloud"
  | "ollama"
  | "deepseek"
  | "MiniMax"
  | "kimi"
  | "kimi-coding"
  | "openai"
  | "claude"
  | "gemini"
  | "custom";

/**
 * プロバイダ・プリセットの設定。
 * - displayName: 設定タブのドロップダウン表示名（日本語）
 * - baseUrl / model: 既定値（プリセット選択時に自動入力）
 * - apiFormat: Anthropic 互換か OpenAI 互換か
 * - anthropicVersion: Anthropic 形式時の API バージョン（OpenAI 形式時は不要）
 * - defaultMaxTokens: プリセット既定の最大出力トークン数
 * - requiresApiKey: API キー必須かどうか（Ollama は不要）
 * - apiKeyHint: API キー欄の説明（コンソール URL など）
 */
export interface LlmPresetConfig {
  id: LlmPresetId;
  displayName: string;
  baseUrl: string;
  model: string;
  apiFormat: "openai" | "anthropic";
  anthropicVersion?: string;
  defaultMaxTokens: number;
  requiresApiKey: boolean;
  apiKeyHint?: string;
}

/**
 * プリセット定義。
 * 新しいプロバイダを追加する場合は、ここにエントリを追加するだけで UI と factory が連動する。
 */
export const LLM_PRESETS: Record<LlmPresetId, LlmPresetConfig> = {
  claudian: {
    id: "claudian",
    displayName: "Claudian（デフォルト・プラグイン連携）",
    baseUrl: "",
    model: "",
    apiFormat: "openai",
    defaultMaxTokens: 32000,
    requiresApiKey: false,
    apiKeyHint: "Claudian プラグインが API キーを管理します",
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek（Anthropic 互換）",
    baseUrl: "https://api.deepseek.com/anthropic",
    model: "deepseek-v4-flash",
    apiFormat: "anthropic",
    anthropicVersion: "2023-06-01",
    defaultMaxTokens: 32000,
    requiresApiKey: true,
    apiKeyHint: "DeepSeek コンソール: https://platform.deepseek.com",
  },
  MiniMax: {
    id: "MiniMax",
    displayName: "MiniMax（Anthropic 互換・1M コンテキスト）",
    baseUrl: "https://api.minimaxi.com/anthropic",
    model: "MiniMax-M3[1M]",
    apiFormat: "anthropic",
    anthropicVersion: "2023-06-01",
    defaultMaxTokens: 524288,
    requiresApiKey: true,
    apiKeyHint: "MiniMax コンソール: https://platform.MiniMax.io",
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi（Moonshot・OpenAI 互換）",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-128k",
    apiFormat: "openai",
    defaultMaxTokens: 32000,
    requiresApiKey: true,
    apiKeyHint: "Moonshot AI: https://platform.moonshot.cn",
  },
  "kimi-coding": {
    id: "kimi-coding",
    displayName: "Kimi for Coding（定額制・OpenAI 互換）",
    baseUrl: "https://api.kimi.com/coding/v1",
    model: "kimi-for-coding",
    apiFormat: "openai",
    defaultMaxTokens: 32000,
    requiresApiKey: true,
    apiKeyHint: "Kimi for Coding 定額プラン: https://www.kimi.com/coding（platform.moonshot のキーとは別物）",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiFormat: "openai",
    defaultMaxTokens: 16000,
    requiresApiKey: true,
    apiKeyHint: "OpenAI Platform: https://platform.openai.com",
  },
  claude: {
    id: "claude",
    displayName: "Claude（Anthropic 直）",
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-sonnet-latest",
    apiFormat: "anthropic",
    anthropicVersion: "2023-06-01",
    defaultMaxTokens: 8192,
    requiresApiKey: true,
    apiKeyHint: "Anthropic Console: https://console.anthropic.com",
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini（OpenAI 互換）",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-1.5-flash",
    apiFormat: "openai",
    defaultMaxTokens: 8192,
    requiresApiKey: true,
    apiKeyHint: "Google AI Studio: https://aistudio.google.com",
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama（ローカル）",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5",
    apiFormat: "openai",
    defaultMaxTokens: 32000,
    requiresApiKey: false,
    apiKeyHint: "Ollama は API キー不要",
  },
  cloud: {
    id: "cloud",
    displayName: "クラウド（OpenAI 互換・カスタム）",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiFormat: "openai",
    defaultMaxTokens: 32000,
    requiresApiKey: true,
    apiKeyHint: "任意の OpenAI 互換エンドポイント",
  },
  custom: {
    id: "custom",
    displayName: "カスタム（baseUrl / モデル手動設定）",
    baseUrl: "",
    model: "",
    apiFormat: "openai",
    defaultMaxTokens: 32000,
    requiresApiKey: false,
    apiKeyHint: "任意の LLM エンドポイント",
  },
};

/**
 * 設定タブのドロップダウン表示順。
 * 推奨（DeepSeek / MiniMax / Kimi）を上位に配置。
 */
export const PRESET_DISPLAY_ORDER: LlmPresetId[] = [
  "claudian",
  "deepseek",
  "MiniMax",
  "kimi",
  "kimi-coding",
  "openai",
  "claude",
  "gemini",
  "ollama",
  "cloud",
  "custom",
];

/** 未知 ID 安全に取得する。型ガードなし（呼び出し側で存在チェック必要） */
export function getPreset(id: string): LlmPresetConfig | undefined {
  return LLM_PRESETS[id as LlmPresetId];
}

/**
 * LLM 設定が完了しているか判定する（接続テスト・runAutoSummarize で共用）。
 * - claudian: プラグイン検出側で判定するので true 固定
 * - その他: baseUrl / model 必須 + preset.requiresApiKey なら apiKey 必須
 */
export function isLlmConfigured(settings: GijiSettings): boolean {
  if (settings.llmProvider === "claudian") return true;
  const preset = getPreset(settings.llmProvider);
  if (!preset) return false;
  if (!settings.llmBaseUrl.trim()) return false;
  if (!settings.llmModel.trim()) return false;
  if (preset.requiresApiKey && !settings.llmApiKey) return false;
  return true;
}

/**
 * プリセットを適用した新しい settings オブジェクトを返す（純粋関数）。
 * - claudian / custom: ユーザーが既に設定した baseUrl / model を**保持**（上書きしない）
 * - その他: preset の既定値で baseUrl / model / llmApiFormat / anthropicVersion / llmMaxTokens を上書き
 * - timeoutMs / retries / apiKey / autoSummarizeEnabled / debugLog などは**常に保持**
 */
export function applyPreset(settings: GijiSettings, presetId: LlmPresetId): GijiSettings {
  const preset = LLM_PRESETS[presetId];
  if (!preset) return settings;
  const preserveUserInput = preset.id === "claudian" || preset.id === "custom";
  return {
    ...settings,
    llmProvider: preset.id,
    llmBaseUrl: preserveUserInput ? settings.llmBaseUrl : preset.baseUrl,
    llmModel: preserveUserInput ? settings.llmModel : preset.model,
    llmApiFormat: preset.apiFormat,
    anthropicVersion: preset.anthropicVersion ?? settings.anthropicVersion,
    llmMaxTokens: preset.defaultMaxTokens,
  };
}