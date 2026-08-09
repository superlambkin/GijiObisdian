import type { GijiSettings, SttProviderId, SttProviderProfile } from "../settings";

/**
 * 現在の STT API キーを provider 別プロファイルとして保存した新しい settings を返す。
 * 接続テスト成功時・provider 切替時に呼ばれ、provider 間でキーを共有しない。
 */
export function saveSttProviderProfile(settings: GijiSettings, providerId: string): GijiSettings {
  return {
    ...settings,
    sttProviderProfiles: {
      ...(settings.sttProviderProfiles ?? {}),
      [providerId]: { sttApiKey: settings.sttApiKey },
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
  const saved = next.sttProviderProfiles?.[newProviderId]?.sttApiKey;
  return { ...next, sttApiKey: saved ?? "" };
}
