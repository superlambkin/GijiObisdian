import { GijiSettings, isLocalSttProvider } from "../settings";
import { createSttProvider } from "../providers/stt";
import { ensureWhisperLocalServer } from "../whisperLocalLauncher";
import { decodeTestAudio, decodeTestAudioJa } from "./audioSample";
import { nodeFetch } from "../providers/nodeFetch";

export interface SttTestResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function runSttTest(
  settings: GijiSettings,
  fetchImpl: typeof fetch = nodeFetch
): Promise<SttTestResult> {
  // ローカル STT（whisper-local / mywhisper）は API キー不要
  if (!isLocalSttProvider(settings.sttProvider) && !settings.sttApiKey) {
    return { ok: false, error: "请先填写 STT API Key" };
  }
  try {
    const provider = createSttProvider(settings, fetchImpl);
    // whisper-local のみ Whisper サーバ自動起動を試みる（mywhisper は LAN 外部サーバ・クラウドは対象外）
    if (settings.sttProvider === "whisper-local") {
      await ensureWhisperLocalServer(settings, { fetchImpl });
    }
    const audio = settings.sttLang === "ja" ? decodeTestAudioJa() : decodeTestAudio();
    const text = await provider.transcribe(audio, settings.sttLang);
    if (!text.trim()) return { ok: false, error: "请求成功但未识别出文本" };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
