import type { GijiSettings, SttProviderId, SttProviderProfile } from "../settings";

/**
 * provider 切替時にプロファイルへ退避する settings キー集合。
 * `mywhisper` ↔ 他 provider の往復でも Base URL と Token を保持するために使用。
 */
const STT_PROFILE_BACKUP_KEYS = new Set([
  "sttApiKey",
  "sttBaseUrl",
  "sttModel",
  "sttMyWhisperBaseUrl", // ← 追加: MyWhisper (POC_020) ASR サーバ Base URL
  "sttMyWhisperToken",   // ← 追加: MyWhisper 用 Bearer Token（:9000 は無認証のため通常空）
]);

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
