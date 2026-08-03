// Test setup: stub the `obsidian` module so unit tests run in plain node.
const Module = require("module");
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return {
      Plugin: class {},
      PluginSettingTab: class {
        constructor(app, plugin) {}
      },
      Setting: class {
        constructor(el) {
          this.el = el;
        }
        setName() {
          return this;
        }
        setDesc() {
          return this;
        }
        addDropdown() {
          return this;
        }
        addText() {
          return this;
        }
        addTextArea() {
          return this;
        }
        addToggle() {
          return this;
        }
      },
      App: class {},
    };
  }
  return originalLoad(request, parent, isMain);
};
