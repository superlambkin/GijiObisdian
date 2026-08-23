import type { GijiSettings, SttProviderId, SttProviderProfile } from "../settings";

/**
 * provider 切替時にプロファイルへ退避する settings キー集合。
 * `mywhisper` ↔ 他 provider の往復でも Base URL と Token を保持するために使用。
 */
const STT_PROFILE_BACKUP_KEYS = new Set([
  "sttApiKey",
  "sttBaseUrl",
  "sttModel",
  "sttMyWhisperBaseUrl", // ← MyWhisper (POC_020) ASR サーバ Base URL
  "sttMyWhisperToken",   // ← MyWhisper 用 Bearer Token（:9000 は無認証のため通常空）
]);

function pickProfileFields(settings: GijiSettings): Partial<GijiSettings> {
  const out: Partial<GijiSettings> = {};
  for (const k of STT_PROFILE_BACKUP_KEYS) {
    (out as any)[k] = (settings as any)[k];
  }
  return out;
}

/**
 * 現在の STT API キー・URL・model を provider 別プロファイルとして保存した新しい settings を返す。
 * 接続テスト成功時・provider 切替時に呼ばれ、provider 間でキー/URL を共有しない。
 */
export function saveSttProviderProfile(settings: GijiSettings, providerId: string): GijiSettings {
  return {
    ...settings,
    sttProviderProfiles: {
      ...(settings.sttProviderProfiles ?? {}),
      [providerId]: pickProfileFields(settings) as SttProviderProfile,
    },
  };
}

/**
 * STT provider 切替ヘルパ:
 * 1. 旧 provider の現在キーをプロファイルに保存
 * 2. 新 provider に切り替える
 * 3. 新 provider の保存済みキーを反映（無ければクリアして旧キーを引き継がない）
 */
export function switchSttProvider(
  settings: GijiSettings,
  newProviderId: SttProviderId
): GijiSettings {
  let next = saveSttProviderProfile(settings, settings.sttProvider);
  next = { ...next, sttProvider: newProviderId };
  const saved = next.sttProviderProfiles?.[newProviderId];
  // 復元: 保存済みフィールドを反映、無ければクリア
  const restore: Record<string, string> = {};
  for (const k of STT_PROFILE_BACKUP_KEYS) {
    restore[k] = (saved as any)?.[k] ?? "";
  }
  return { ...next, ...restore } as GijiSettings;
}
