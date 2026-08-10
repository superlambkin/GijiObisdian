export const RECORDING_STYLES_CSS = `
.giji-record-btn.giji-recording {
  color: #e33 !important;
  animation: giji-blink 1s ease-in-out infinite;
}
/* ローカル STT サーバ未起動時：録音しても転写できない警告（赤背景） */
.giji-record-btn.giji-stt-down {
  background: #e33 !important;
  color: #fff !important;
  border-color: #b22 !important;
}
@keyframes giji-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
`;

export function injectRecordingStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("giji-recording-styles")) return;
  const style = document.createElement("style");
  style.id = "giji-recording-styles";
  style.textContent = RECORDING_STYLES_CSS;
  document.head.appendChild(style);
}
