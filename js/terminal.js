/* ═══════════════ terminal.js — 设备命令行终端（底部面板内多窗口） ═══════════════ */
(function (root) {
  const NS = root.NS = root.NS || {};
  const L = (zh, en) => (NS.I18N.lang === 'zh' ? zh : en);

  const tabsEl = () => document.getElementById('terminal-tabs');
  const areaEl = () => document.getElementById('terminal-area');

  class Terminal {
    constructor(dev) {
      this.dev = dev;
      this.job = null;          // 当前异步作业（ping -t / tracert / telnet…）
      this.history = [];
      this.hIdx = -1;

      /* ── 窗口 ── */
      this.win = document.createElement('div');
      this.win.className = 'term-win';
      this.out = document.createElement('div');
      this.out.className = 'term-output';
      const inLine = document.createElement('div');
      inLine.className = 'term-input-line';
      this.promptEl = document.createElement('span');
      this.promptEl.className = 'prompt';
      this.input = document.createElement('input');
      this.input.type = 'text';
      this.input.autocomplete = 'off';
      this.input.spellcheck = false;
      inLine.append(this.promptEl, this.input);
      this.win.append(this.out, inLine);

      /* ── 页签 ── */
      this.tab = document.createElement('button');
      this.tab.className = 'ttab';
      this.tab.innerHTML = `<span class="tname"></span><span class="tclose">✕</span>`;
      this.tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('tclose')) { NS.Terminals.close(this.dev.id); return; }
        NS.Terminals.activate(this.dev.id);
      });

      this.input.addEventListener('keydown', (e) => this.onKey(e));
      this.win.addEventListener('click', () => this.input.focus());

      this.refreshNames();
      this.banner();
    }

    refreshNames() {
      this.tab.querySelector('.tname').textContent = this.dev.name;
      this.promptEl.textContent = this.dev.name + '>';
    }

    banner() {
      const zh = NS.I18N.lang === 'zh';
      this.print(zh ? 'Microsoft Windows [版本 10.0.22631.4602]'
                    : 'Microsoft Windows [Version 10.0.22631.4602]', 'term-banner');
      this.print(zh ? '(c) Microsoft Corporation。保留所有权利。'
                    : '(c) Microsoft Corporation. All rights reserved.', 'term-banner');
      this.print('');
      this.print(L('输入 help 查看可用命令。按 Ctrl+C 中断正在运行的命令。',
                  'Type help for available commands. Press Ctrl+C to interrupt a running command.'), 't-dim');
      this.print('');
    }

    print(text, cls) {
      const div = document.createElement('div');
      if (cls) div.className = cls;
      div.textContent = text == null ? '' : String(text);
      this.out.appendChild(div);
      while (this.out.children.length > 1500) this.out.removeChild(this.out.firstChild);
      this.out.scrollTop = this.out.scrollHeight;
    }

    clear() { this.out.innerHTML = ''; }

    focus() { this.input.focus(); }

    abortJob() {
      const job = this.job;
      if (!job) return;
      this.job = null;
      this.input.readOnly = false;
      try { job.abort(); } catch (err) { console.error(err); }
    }

    onKey(e) {
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        this.print('^C');
        this.abortJob();
        e.preventDefault();
        return;
      }
      if (this.input.readOnly) {
        if (e.key === 'Enter') {
          this.print(NS.t('term.busy'), 't-dim');
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Enter') {
        const line = this.input.value;
        this.input.value = '';
        this.history.push(line);
        this.hIdx = this.history.length;
        this.print(this.dev.name + '>' + line);
        this.handleLine(line);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        if (this.hIdx > 0) { this.hIdx--; this.input.value = this.history[this.hIdx] || ''; }
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (this.hIdx < this.history.length - 1) { this.hIdx++; this.input.value = this.history[this.hIdx] || ''; }
        else { this.hIdx = this.history.length; this.input.value = ''; }
        e.preventDefault();
      }
    }

    handleLine(line) {
      if (!line.trim()) return;
      if (!this.dev.on) {
        this.print(L('设备已关机，无法执行命令。请在右侧属性面板开机。', 'Device is powered off. Turn it on in the inspector panel.'), 't-err');
        return;
      }
      if (this.job) {
        if (this.job.wantsInput) this.job.onLine(line);
        else this.print(NS.t('term.busy'), 't-dim');
        return;
      }

      let job;
      let finished = false;
      const ctx = {
        dev: this.dev,
        print: (t, c) => this.print(t, c),
        clear: () => this.clear(),
        endJob: () => {
          finished = true;
          if (job && this.job === job) {
            this.job = null;
            this.input.readOnly = false;
          }
        },
        exit: () => NS.Terminals.close(this.dev.id),
      };
      job = NS.Commands.execute(line, ctx);
      if (job && !finished) {
        this.job = job;
        this.input.readOnly = !job.wantsInput;
      }
    }
  }

  /* ── 多终端管理 ── */
  const Terminals = {
    map: new Map(),     // devId -> Terminal
    activeId: null,

    open(devId) {
      const dev = NS.world.devices.get(devId);
      if (!dev) return;
      let t = this.map.get(devId);
      if (!t) {
        t = new Terminal(dev);
        this.map.set(devId, t);
        tabsEl().appendChild(t.tab);
        areaEl().appendChild(t.win);
      }
      this.activate(devId);
    },

    activate(devId) {
      this.activeId = devId;
      this.map.forEach((t, id) => {
        const on = id === devId;
        t.tab.classList.toggle('active', on);
        t.win.classList.toggle('active', on);
      });
      const t = this.map.get(devId);
      if (t) setTimeout(() => t.focus(), 0);
      this.refreshEmpty();
    },

    close(devId) {
      const t = this.map.get(devId);
      if (!t) return;
      t.abortJob();
      t.tab.remove(); t.win.remove();
      this.map.delete(devId);
      if (this.activeId === devId) {
        const next = [...this.map.keys()][0] || null;
        if (next) this.activate(next); else { this.activeId = null; this.refreshEmpty(); }
      }
    },

    closeAll() { [...this.map.keys()].forEach(id => this.close(id)); },

    interruptOnPowerOff(devId) {
      const terminal = this.map.get(devId);
      if (!terminal?.job) return;
      terminal.abortJob();
      terminal.print(NS.t('term.powerOff'), 't-err');
    },

    /* 设备更名时同步页签 */
    rename(devId) {
      const t = this.map.get(devId);
      if (t) t.refreshNames();
    },

    refreshEmpty() {
      let ph = document.getElementById('term-empty');
      if (!this.map.size) {
        if (!ph) {
          ph = document.createElement('div');
          ph.id = 'term-empty';
          ph.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:13px;background:#232637;';
          ph.setAttribute('data-i18n', 'term.empty');
          areaEl().appendChild(ph);
          ph.textContent = NS.t('term.empty');
        }
      } else if (ph) ph.remove();
    },

    /* 设备删除时关掉它的终端 */
    cleanupDevice(devId) { if (this.map.has(devId)) this.close(devId); },
  };
  NS.Terminals = Terminals;

  NS.I18N.register({
    'term.empty': { zh: '双击画布中的设备打开命令行终端', en: 'Double-click a device on the canvas to open its terminal' },
    'term.busy': { zh: '当前命令正在运行。按 Ctrl+C 中断。', en: 'A command is running. Press Ctrl+C to interrupt it.' },
    'term.powerOff': { zh: '设备已关机，当前命令已中断。', en: 'Device powered off. The current command was interrupted.' },
  });
})(typeof window !== 'undefined' ? window : globalThis);
