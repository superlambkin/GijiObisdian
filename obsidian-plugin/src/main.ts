import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings, GijiSettingsTab } from "./settings";
import { startSegment, stopSegment } from "./commands/recordSegment";
import { importAudioFlow } from "./ui/filePicker";

export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new GijiSettingsTab(this.app, this));

    this.addCommand({
      id: "record-start",
      name: "开始录音（会议分段）",
      callback: () => startSegment(this.app, this.settings),
    });
    this.addCommand({
      id: "record-stop",
      name: "停止并转写（追加到笔记）",
      callback: () => stopSegment(this.app, this.settings),
    });
    this.addCommand({
      id: "import-audio",
      name: "导入音频生成会议纪要",
      callback: () => importAudioFlow(this.app, this.settings),
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
