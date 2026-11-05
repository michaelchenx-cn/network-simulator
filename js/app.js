/* ═══════════════ app.js — 启动装配 ═══════════════ */
(function (root) {
  const NS = root.NS = root.NS || {};
  const $ = (id) => document.getElementById(id);

  /* ── Toast ── */
  NS.toast = (msg, type = 'info', duration = 3200) => {
    const box = $('toast-container');
    const d = document.createElement('div');
    d.className = `toast toast-${type}`;
    d.innerHTML = msg;
    box.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .3s'; setTimeout(() => d.remove(), 320); }, duration);
  };

  const App = {
    showTab(name) {
      document.querySelectorAll('.btab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
      document.querySelectorAll('.bpane').forEach(p => p.classList.remove('active'));
      const pane = $('pane-' + name);
      if (pane) {
        pane.classList.add('active');
        if (name === 'sniffer') pane.style.display = 'flex';
      }
      document.querySelectorAll('.bpane').forEach(p => {
        if (p.classList.contains('active')) { p.style.display = p.id === 'pane-log' ? 'block' : 'flex'; }
        else p.style.display = 'none';
      });
      this.renderTabActions(name);
    },

    renderTabActions(name) {
      const box = $('tab-actions');
      box.innerHTML = '';
      if (name === 'terminals') {
        const b = document.createElement('button');
        b.textContent = NS.t('bt.closeAll');
        b.addEventListener('click', () => NS.Terminals.closeAll());
        box.appendChild(b);
      } else if (name === 'log') {
        const b = document.createElement('button');
        b.textContent = NS.t('log.cleared') === NS.t('log.cleared') ? (NS.I18N.lang === 'zh' ? '清空日志' : 'Clear log') : '';
        b.addEventListener('click', () => { NS.Logger.clear(); $('log-area').innerHTML = ''; });
        box.appendChild(b);
      }
    },

    /* ── 帮助内容 ── */
    helpHtml() {
      const zh = NS.I18N.lang === 'zh';
      if (zh) {
        return `
<h4>快速上手</h4>
<ol style="margin-left:18px;">
<li>工具栏选择 <b>PC / 路由器 / 交换机 / 服务器</b>，单击画布放置；<b>连线模式</b>下依次点击两台设备连线</li>
<li>单击设备 → 右侧面板配置 IP / 掩码 / 网关 / 静态路由；<b>双击设备</b>打开命令行终端</li>
<li>底部【抓包】查看报文与逐层解码；【事件日志】查看内核转发记录</li>
<li>⏸ 暂停 + <b>⏭ 单步</b> 可逐帧演示三次握手等过程；倍速滑块调整仿真速度</li>
</ol>
<h4>终端命令</h4>
<table><tr><th>命令</th><th>作用</th></tr>
<tr><td><code>ipconfig /all</code></td><td>查看 IP / 掩码 / 网关 / MAC</td></tr>
<tr><td><code>ping [-n 5|-t] IP</code></td><td>ICMP 连通性测试（可观察 ARP）</td></tr>
<tr><td><code>tracert IP</code></td><td>逐跳路径跟踪（TTL 递增）</td></tr>
<tr><td><code>arp -a / arp -d</code></td><td>查看 / 清空 ARP 缓存</td></tr>
<tr><td><code>netstat -an</code></td><td>TCP 连接与状态（握手/挥手观察）</td></tr>
<tr><td><code>route print/add/delete</code></td><td>路由表管理</td></tr>
<tr><td><code>telnet IP [端口]</code></td><td>TCP 会话（三次握手 / 四次挥手）</td></tr>
<tr><td><code>http IP</code></td><td>模拟 HTTP 访问全过程</td></tr>
<tr><td><code>show ip route / show mac</code></td><td>路由器 / 交换机视图</td></tr></table>
<h4>教学提示</h4>
<ul style="margin-left:18px;">
<li>报文配色：黄=ARP，青=ICMP，绿=SYN，灰=ACK，蓝=数据，橙=FIN，红=ICMP错误/RST</li>
<li>断开链路 / 关机 / 设置丢包率可制造故障，用于排障教学</li>
<li>实验面板（工具栏【实验】）内置 5 个带验收的课堂实验</li>
</ul>`;
      }
      return `
<h4>Quick start</h4>
<ol style="margin-left:18px;">
<li>Pick <b>PC / Router / Switch / Server</b> from the toolbar and click the canvas; in <b>link mode</b> click two devices to connect them</li>
<li>Click a device to configure IP/mask/gateway/routes on the right; <b>double-click</b> to open its terminal</li>
<li>The bottom <b>Sniffer</b> tab shows frames with layer-by-layer decoding; <b>Event log</b> shows kernel forwarding</li>
<li>⏸ pause + <b>⏭ single step</b> to walk through the 3-way handshake frame by frame; the speed slider scales time</li>
</ol>
<h4>Terminal commands</h4>
<table><tr><th>Command</th><th>Purpose</th></tr>
<tr><td><code>ipconfig /all</code></td><td>IP / mask / gateway / MAC</td></tr>
<tr><td><code>ping [-n 5|-t] ip</code></td><td>ICMP reachability (watch ARP too)</td></tr>
<tr><td><code>tracert ip</code></td><td>Hop-by-hop trace (incrementing TTL)</td></tr>
<tr><td><code>arp -a / arp -d</code></td><td>Show / flush ARP cache</td></tr>
<tr><td><code>netstat -an</code></td><td>TCP connections & states</td></tr>
<tr><td><code>route print/add/delete</code></td><td>Routing table</td></tr>
<tr><td><code>telnet ip [port]</code></td><td>TCP session (handshake / close)</td></tr>
<tr><td><code>http ip</code></td><td>Full HTTP fetch simulation</td></tr>
<tr><td><code>show ip route / show mac</code></td><td>Router / switch views</td></tr></table>
<h4>Teaching tips</h4>
<ul style="margin-left:18px;">
<li>Packet colors: amber=ARP, teal=ICMP, green=SYN, grey=ACK, blue=data, orange=FIN, red=ICMP errors/RST</li>
<li>Break links, power off devices or set loss rate to create troubleshooting scenarios</li>
<li>The Labs panel (toolbar 【实验】) ships 5 classroom labs with auto-verification</li>
</ul>`;
    },

    init() {
      /* 语言初始应用 */
      NS.I18N.apply();
      $('btn-lang').textContent = NS.I18N.lang === 'zh' ? '中 / EN' : 'EN / 中';

      /* 各模块初始化 */
      NS.Canvas.init();
      NS.Sniffer.init();
      NS.Sniffer.bind();
      NS.Labs.init();
      NS.Inspector.show(null);
      NS.SimLoop.start();

      /* ── 工具栏 ── */
      document.querySelectorAll('.pal-btn').forEach(b => b.addEventListener('click', () => NS.Canvas.setPlace(b.dataset.place)));
      $('btn-select').addEventListener('click', () => NS.Canvas.setMode('select'));
      $('btn-link').addEventListener('click', () => { NS.Canvas.setMode('link'); NS.toast(NS.t('toast.linkFirst'), 'info'); });
      $('btn-delete').addEventListener('click', () => NS.Canvas.setMode('delete'));
      $('btn-run').addEventListener('click', () => NS.SimLoop.toggle());
      $('btn-step').addEventListener('click', () => NS.SimLoop.step());
      $('sel-speed').addEventListener('change', (e) => NS.SimLoop.setSpeed(+e.target.value));
      $('btn-labs').addEventListener('click', () => $('labs-panel').classList.toggle('collapsed'));
      $('btn-lang').addEventListener('click', () => {
        NS.I18N.toggle();
        $('btn-lang').textContent = NS.I18N.lang === 'zh' ? '中 / EN' : 'EN / 中';
      });
      $('btn-help').addEventListener('click', () => {
        $('help-body').innerHTML = App.helpHtml();
        $('modal-help').classList.remove('hidden');
      });
      document.querySelector('#modal-help .modal-close').addEventListener('click', () => $('modal-help').classList.add('hidden'));
      $('modal-help').addEventListener('click', (e) => { if (e.target.id === 'modal-help') $('modal-help').classList.add('hidden'); });

      /* 仿真状态按钮 */
      NS.Bus.on('sim:state', (run) => {
        $('btn-run').textContent = run ? '⏸' : '▶';
        $('btn-run').classList.toggle('running', run);
      });

      /* 导出 / 导入 / 清空 */
      $('btn-export').addEventListener('click', () => {
        const data = JSON.stringify(NS.saveTopology(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'topology.json';
        a.click();
        URL.revokeObjectURL(a.href);
        NS.toast(NS.t('toast.exported'), 'ok');
      });
      $('btn-import').addEventListener('click', () => $('file-import').click());
      $('file-import').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const ok = NS.loadTopology(JSON.parse(rd.result));
            NS.toast(ok ? NS.t('toast.imported') : NS.t('toast.importErr'), ok ? 'ok' : 'err');
            if (ok) NS.Canvas.select(null);
          } catch (err) { NS.toast(NS.t('toast.importErr'), 'err'); }
        };
        rd.readAsText(f);
        e.target.value = '';
      });
      $('btn-new').addEventListener('click', () => {
        if (confirm(NS.t('toast.confirmNew'))) {
          NS.world.clear();
          NS.Terminals.closeAll();
          NS.Canvas.select(null);
          NS.toast(NS.t('toast.cleared'), 'ok');
        }
      });

      /* 画布缩放按钮 */
      $('zoom-in').addEventListener('click', () => NS.Canvas.zoomAt(1.25, 300, 200));
      $('zoom-out').addEventListener('click', () => NS.Canvas.zoomAt(0.8, 300, 200));
      $('zoom-reset').addEventListener('click', () => { NS.Canvas.view = { x: 0, y: 0, k: 1 }; NS.Canvas.applyView(); });

      /* 底部页签 */
      document.querySelectorAll('.btab[data-tab]').forEach(b => b.addEventListener('click', () => App.showTab(b.dataset.tab)));
      App.showTab('terminals');

      /* 底部面板拖高 */
      const resizer = document.createElement('div');
      resizer.id = 'bottom-resizer';
      resizer.style.cssText = 'position:absolute;left:0;right:0;height:6px;cursor:ns-resize;z-index:30;';
      document.body.appendChild(resizer);
      const placeResizer = () => { resizer.style.bottom = getComputedStyle(document.body).getPropertyValue('--bottom-h') || '250px'; };
      placeResizer();
      let rz = null;
      resizer.addEventListener('pointerdown', (e) => { rz = { y: e.clientY, h: parseFloat(getComputedStyle(document.body).getPropertyValue('--bottom-h')) }; e.preventDefault(); });
      window.addEventListener('pointermove', (e) => {
        if (!rz) return;
        const h = Math.max(110, Math.min(window.innerHeight * 0.65, rz.h + (rz.y - e.clientY)));
        document.body.style.setProperty('--bottom-h', h + 'px');
        placeResizer();
      });
      window.addEventListener('pointerup', () => { rz = null; placeResizer(); });

      /* 事件日志 */
      NS.Bus.on('log', (e) => {
        const area = $('log-area');
        if (!area) return;
        const d = document.createElement('div');
        d.className = 'log-line ' + e.level;
        d.innerHTML = `<span class="lt">${(e.t / 1000).toFixed(2)}s</span><span class="lm"></span>`;
        d.querySelector('.lm').textContent = e.msg;
        area.appendChild(d);
        while (area.children.length > 1000) area.removeChild(area.firstChild);
        area.scrollTop = area.scrollHeight;
      });

      /* 时钟 */
      NS.SimLoop.onTick(() => { $('sim-clock').textContent = NS.fmtClock(NS.Engine.time); });

      /* 语言切换 → 面板文本刷新 */
      NS.I18N.onChange(() => {
        NS.I18N.apply();
        $('btn-lang').textContent = NS.I18N.lang === 'zh' ? '中 / EN' : 'EN / 中';
        App.renderTabActions(document.querySelector('.btab.active')?.dataset.tab || 'terminals');
        const ph = document.getElementById('term-empty');
        if (ph) ph.textContent = NS.t('term.empty');
      });

      /* 拓扑变化自动保存 */
      let saveTimer = null;
      const autosave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          try { localStorage.setItem('ns.topo', JSON.stringify(NS.saveTopology())); } catch (e) {}
        }, 800);
      };
      NS.Bus.on('world:changed', autosave);
      NS.Bus.on('topology:touched', autosave);
      window.addEventListener('beforeunload', () => {
        try { localStorage.setItem('ns.topo', JSON.stringify(NS.saveTopology())); } catch (e) {}
      });

      /* 恢复或首次运行 */
      let restored = false;
      try {
        const s = localStorage.getItem('ns.topo');
        if (s) restored = NS.loadTopology(JSON.parse(s));
      } catch (e) {}
      if (!restored || NS.world.devices.size === 0) {
        NS.world.clear();
        $('labs-panel').classList.remove('collapsed');   // 首次运行展开实验面板
      }
      NS.log('网络模拟器就绪 / simulator ready', 'ok');
    },
  };
  NS.App = App;

  document.addEventListener('DOMContentLoaded', () => App.init());
})(typeof window !== 'undefined' ? window : globalThis);
