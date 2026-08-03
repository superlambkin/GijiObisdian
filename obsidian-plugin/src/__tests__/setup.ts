// Test setup: stub the `obsidian` module so unit tests run in plain node.
import { mock } from "node:test";

mock.module("obsidian", {
  namedExports: {
    Plugin: class {},
    PluginSettingTab: class {},
    Setting: class {},
    App: class {},
  },
});
