export const RECORDING_STYLES_CSS = `
.giji-record-btn.giji-recording {
  color: #e33 !important;
  animation: giji-blink 1s ease-in-out infinite;
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
