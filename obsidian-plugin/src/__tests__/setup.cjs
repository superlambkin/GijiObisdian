// Test setup: stub the `obsidian` module so unit tests run in plain node.
const Module = require("module");
const originalLoad = Module._load;

// M3: confirmModal テスト用に、テストから最後に生成された Modal インスタンスを
// 参照できるよう共有変数（プロセスグローバル）で参照する。
globalThis.__lastModal = null;
globalThis.__resetLastModal = () => { globalThis.__lastModal = null; };

const obsidianStub = {
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
    // M3: confirmModal の button 押下テスト用。setButtonText / setCta / onClick を
    // チェーナブルにしつつ、後から onClick のコールバックを実行できるよう
    // 各 button を Setting インスタンス経由（this._buttons）で記録する。
    addButton(cb) {
      const self = this;
      // el（= contentEl）に setting への参照を記録し、テストから button 一覧を取得できるようにする
      if (self.el && !self.el._setting) self.el._setting = self;
      const b = {
        _text: "",
        _isCta: false,
        _onClick: null,
        setButtonText(t) {
          this._text = t;
          return this;
        },
        setCta() {
          this._isCta = true;
          return this;
        },
        onClick(fn) {
          this._onClick = fn;
          if (!self._buttons) self._buttons = [];
          self._buttons.push(this);
          return this;
        },
      };
      cb(b);
      return this;
    }
  },
  App: class {},
  Notice: class {
    constructor(_message) {}
  },
  Modal: class {
    constructor(_app) {
      // M3: confirmModal テストで createEl / empty を必要とするため最小スタブを返す
      this.contentEl = {
        _children: [],
        _buttons: [],
        createEl(_tag, _opts) {
          return { setText(t) { return this; }, _text: _opts && _opts.text };
        },
        empty() {
          this._children = [];
          this._buttons = [];
        },
      };
      globalThis.__lastModal = this;
    }
    open() {
      // Obsidian 本物は open 時に onOpen を呼び出す。スタブでも再現する。
      if (typeof this.onOpen === "function") this.onOpen();
    }
    close() {
      if (typeof this.onClose === "function") this.onClose();
    }
  },
};

Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    return obsidianStub;
  }
  return originalLoad(request, parent, isMain);
};
