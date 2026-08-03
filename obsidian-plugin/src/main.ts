import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings } from "./settings";

export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // inside onload(), after loadSettings()
    this.addCommand({
      id: "import-audio-to-minutes",
      name: "导入音频生成会议纪要",
      callback: async () => {
        // file picker handled by Obsidian; here we invoke pipeline with chosen wav buffer.
        // Wired fully in Task 7 with Notice + file picker modal.
      },
    });

    // commands wired in Task 7
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
