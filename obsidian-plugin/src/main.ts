import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, GijiSettings } from "./settings";

export default class GijiPlugin extends Plugin {
  settings: GijiSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    // commands wired in Task 7
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
