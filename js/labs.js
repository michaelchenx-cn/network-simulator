/* ═══════════════ labs.js — 预置实验场景 ═══════════════
 * 每个实验 = 拓扑构建 + 双语任务目标 + 自动验收检查（部分）+ 参考答案。
 */
(function (root) {
  const NS = root.NS = root.NS || {};
  const pick = (o) => (NS.I18N.lang === 'zh' ? o.zh : o.en);

  function cfg(dev, ifName, ip, mask, gw) { dev.setIfConfig(ifName, { ip, mask, gw: gw || '' }); }

  /* ping 型验收 */
  function pingCheck(from, targetIp) {
    return (done) => {
      NS.SimLoop.play();
      NS.Proto.icmpEcho(from, targetIp, { echoId: 0x7A00 + Math.floor(Math.random() * 255), timeout: 3000 },
        (res) => done(res.kind === 'reply'));
    };
  }

  const LABS = [
    {
      id: 'lab-ip',
      title: { zh: '实验 1 · IP 配置与直连通', en: 'Lab 1 · IP configuration & direct connectivity' },
      desc: { zh: '两台 PC 通过交换机相连。学习配置 IP 地址 / 子网掩码，理解同网段直连通信。',
              en: 'Two PCs on one switch. Configure IP/mask and understand same-subnet communication.' },
      goals: {
        zh: [
          '双击 <code>PC1</code> 打开终端，执行 <code>ipconfig</code> 查看初始状态（未配置 IP）',
          '在右侧属性面板为 <code>PC1</code> 配置 <code>192.168.1.10 / 255.255.255.0</code>，为 <code>PC2</code> 配置 <code>192.168.1.20 / 255.255.255.0</code>（同网段，无需网关）',
          '在 PC1 上执行 <code>ping 192.168.1.20</code>，应能 ping 通',
          '打开底部【抓包】页签观察：第一个报文是 <b>ARP 广播请求</b>（Who has…），然后是 ARP 应答，之后才是 ICMP——理解"ping 之前先 ARP"',
          '在 PC1 执行 <code>arp -a</code> 查看 ARP 缓存；单击 Switch1 查看 MAC 地址表',
        ],
        en: [
          'Double-click <code>PC1</code> to open a terminal; run <code>ipconfig</code> (no IP yet)',
          'In the inspector, give <code>PC1</code> <code>192.168.1.10/255.255.255.0</code> and <code>PC2</code> <code>192.168.1.20/255.255.255.0</code> (same subnet, no gateway needed)',
          'From PC1 run <code>ping 192.168.1.20</code> — it should succeed',
          'Open the Sniffer tab: the first frame is an <b>ARP broadcast</b> (Who has…), then the reply, and only then ICMP — "ARP before ping"',
          'Run <code>arp -a</code> on PC1; click Switch1 to inspect its MAC table',
        ],
      },
      build() {
        const sw = NS.createDevice('switch', 400, 240);
        const pc1 = NS.createDevice('pc', 160, 150);
        const pc2 = NS.createDevice('pc', 160, 330);
        NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw);
      },
      checks: [
        {
          label: { zh: '两台 PC 已配置同网段 IP', en: 'Both PCs have IPs in the same subnet' },
          run(done) {
            const pcs = [...NS.world.devices.values()].filter(d => d.type === 'pc');
            if (pcs.length < 2) return done(false);
            const [a, b] = pcs;
            done(!!(a.interfaces[0].ip && b.interfaces[0].ip &&
              NS.IP.inSubnet(a.interfaces[0].ip, b.interfaces[0].ip, a.interfaces[0].mask)));
          },
        },
        {
          label: { zh: 'PC1 → PC2 ping 连通', en: 'PC1 → PC2 ping succeeds' },
          run(done) {
            const pcs = [...NS.world.devices.values()].filter(d => d.type === 'pc');
            if (pcs.length < 2) return done(false);
            pingCheck(pcs[0], pcs[1].interfaces[0].ip)(done);
          },
        },
      ],
    },

    {
      id: 'lab-route',
      title: { zh: '实验 2 · 跨网段通信与静态路由', en: 'Lab 2 · Cross-subnet routing & static routes' },
      desc: { zh: 'PC1—R1—R2—PC2 链型拓扑，接口 IP 已配好，但两台路由器缺少去对侧的路由。',
              en: 'PC1—R1—R2—PC2. Interface IPs are set, but both routers lack routes to the far side.' },
      goals: {
        zh: [
          '在 PC1 上 <code>ping 192.168.2.10</code>：观察"无法访问目标网络"（R1 无路由，回 ICMP 不可达）',
          '为 <code>Router1</code> 添加静态路由：目标 <code>192.168.2.0</code> 掩码 <code>255.255.255.0</code> 下一跳 <code>10.0.0.2</code>',
          '再次 ping：这次报文能到 R2，但回程丢失——为 <code>Router2</code> 添加返回路由：目标 <code>192.168.1.0</code> 掩码 <code>255.255.255.0</code> 下一跳 <code>10.0.0.1</code>',
          'ping 通后执行 <code>tracert 192.168.2.10</code>，观察两跳路径（TTL 递增 + 路由器回 ICMP 超时）',
          '在路由器终端可用 <code>show ip route</code> 查看路由表',
        ],
        en: [
          'From PC1 <code>ping 192.168.2.10</code>: note "Destination net unreachable" (R1 has no route)',
          'Add a static route on <code>Router1</code>: dest <code>192.168.2.0/255.255.255.0</code> via <code>10.0.0.2</code>',
          'Ping again: the request now reaches R2 but the reply is lost — add the return route on <code>Router2</code>: dest <code>192.168.1.0/255.255.255.0</code> via <code>10.0.0.1</code>',
          'Once it works, run <code>tracert 192.168.2.10</code> and watch the two hops (increasing TTL + ICMP time-exceeded)',
          'On a router terminal, <code>show ip route</code> lists the table',
        ],
      },
      build() {
        const pc1 = NS.createDevice('pc', 100, 240);
        const r1 = NS.createDevice('router', 300, 240);
        const r2 = NS.createDevice('router', 520, 240);
        const pc2 = NS.createDevice('pc', 720, 240);
        NS.connectDevices(pc1, r1); NS.connectDevices(r1, r2); NS.connectDevices(r2, pc2);
        cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0', '192.168.1.1');
        cfg(r1, 'ge0/0', '192.168.1.1', '255.255.255.0');
        cfg(r1, 'ge0/1', '10.0.0.1', '255.255.255.252');
        cfg(r2, 'ge0/0', '10.0.0.2', '255.255.255.252');
        cfg(r2, 'ge0/1', '192.168.2.1', '255.255.255.0');
        cfg(pc2, 'eth0', '192.168.2.10', '255.255.255.0', '192.168.2.1');
      },
      checks: [
        { label: { zh: 'Router1 与 Router2 均已配置去对侧的静态路由', en: 'Both routers have static routes to the far subnet' },
          run(done) {
            const rs = [...NS.world.devices.values()].filter(d => d.type === 'router');
            if (rs.length < 2) return done(false);
            const r1 = rs.find(r => r.name === 'Router1'), r2 = rs.find(r => r.name === 'Router2');
            done(!!(r1 && r2 && r1.staticRoutes.some(r => r.dest === '192.168.2.0') && r2.staticRoutes.some(r => r.dest === '192.168.1.0')));
          } },
        { label: { zh: 'PC1 → 192.168.2.10 ping 连通', en: 'PC1 → 192.168.2.10 ping succeeds' },
          run(done) {
            const pc1 = [...NS.world.devices.values()].find(d => d.name === 'PC1');
            if (!pc1) return done(false);
            pingCheck(pc1, '192.168.2.10')(done);
          } },
      ],
    },

    {
      id: 'lab-arp',
      title: { zh: '实验 3 · ARP 解析与交换机 MAC 学习', en: 'Lab 3 · ARP resolution & switch MAC learning' },
      desc: { zh: '3 台 PC + 1 台交换机。观察 ARP 广播/泛洪过程与交换机 MAC 地址表的学习。',
              en: '3 PCs + 1 switch. Watch ARP broadcast flooding and MAC-table learning.' },
      goals: {
        zh: [
          '先单击 <code>Switch1</code>：MAC 地址表当前为空',
          '在 <code>PC1</code> 上执行 <code>ping 192.168.1.20</code>（PC2），观察黄色 ARP 广播包从交换机<b>泛洪</b>到所有端口（PC3 也收到了广播）',
          '注意 PC3 收到"不是找自己"的 ARP 请求后<b>不回应</b>；只有 PC2 单播应答',
          '再次单击 Switch1：MAC 表已学习到 2 条记录；PC1 执行 <code>arp -a</code> 查看缓存',
          '再 ping PC3（<code>ping 192.168.1.30</code>），观察交换机对<b>已知单播</b>只发对应端口（无泛洪）',
        ],
        en: [
          'Click <code>Switch1</code> first: its MAC table is empty',
          'From <code>PC1</code> run <code>ping 192.168.1.20</code> (PC2): the yellow ARP broadcast is <b>flooded</b> to all ports (PC3 also receives it)',
          'PC3 does <b>not</b> reply to an ARP request not asking for it; only PC2 replies (unicast)',
          'Click Switch1 again: two entries learned; run <code>arp -a</code> on PC1',
          'Ping PC3 (<code>ping 192.168.1.30</code>): a <b>known unicast</b> is forwarded to one port only (no flooding)',
        ],
      },
      build() {
        const sw = NS.createDevice('switch', 430, 240);
        const pc1 = NS.createDevice('pc', 130, 120);
        const pc2 = NS.createDevice('pc', 130, 360);
        const pc3 = NS.createDevice('pc', 700, 240);
        NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw); NS.connectDevices(pc3, sw);
        cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
        cfg(pc2, 'eth0', '192.168.1.20', '255.255.255.0');
        cfg(pc3, 'eth0', '192.168.1.30', '255.255.255.0');
      },
      checks: [
        { label: { zh: 'Switch1 MAC 表已学习 ≥ 3 条', en: 'Switch1 learned ≥ 3 MAC entries' },
          run(done) {
            const sw = [...NS.world.devices.values()].find(d => d.type === 'switch');
            done(!!(sw && sw.macTable.size >= 3));
          } },
        { label: { zh: 'PC1 的 ARP 缓存中有 PC2 与 PC3', en: 'PC1 ARP cache has PC2 and PC3' },
          run(done) {
            const pc1 = [...NS.world.devices.values()].find(d => d.name === 'PC1');
            if (!pc1 || !pc1.arpCaches) return done(false);
            const cache = pc1.arpCaches.get('eth0');
            done(!!(cache && cache.has('192.168.1.20') && cache.has('192.168.1.30')));
          } },
      ],
    },

    {
      id: 'lab-tcp',
      title: { zh: '实验 4 · TCP 三次握手与四次挥手', en: 'Lab 4 · TCP 3-way handshake & 4-way close' },
      desc: { zh: 'PC 与服务器（HTTP/Telnet 已开启）。用 telnet / netstat / 抓包 / 单步慢放观察 TCP 连接全过程。',
              en: 'PC + server (HTTP/Telnet on). Use telnet / netstat / sniffer / single-step to watch TCP lifecycle.' },
      goals: {
        zh: [
          '在 <code>PC1</code> 执行 <code>telnet 192.168.1.20</code> 前先点击工具栏 <b>⏸ 暂停</b>，输入命令后连按 <b>⏭ 单步</b>：逐帧观察 <code>SYN → SYN·ACK → ACK</code> 三次握手',
          '连接期间另开窗口观察：PC1 终端执行 <code>netstat</code>，可看到 <code>SYN_SENT → ESTABLISHED</code> 状态；服务器属性面板的 TCP 连接表同步变化',
          '输入任意文字回车（作为数据发送），再输入 <code>quit</code> 断开：单步观察四次挥手 <code>FIN → ACK → FIN → ACK</code>',
          '断开后立即在 PC1 执行 <code>netstat</code>：还能看到 <code>TIME_WAIT</code> 状态（等待 2MSL 后才彻底关闭）',
          '再试 <code>http 192.168.1.20</code> 观察完整流程：握手 → GET → 响应 → 服务器主动挥手；把服务器 HTTP 服务关掉重试，观察 <code>RST</code>（连接被拒绝）',
        ],
        en: [
          'Pause the sim (⏸), then run <code>telnet 192.168.1.20</code> on <code>PC1</code> and press <b>step (⏭)</b> repeatedly: watch <code>SYN → SYN·ACK → ACK</code>',
          'While connected run <code>netstat</code> on PC1: <code>SYN_SENT → ESTABLISHED</code>; the server inspector shows the matching connection',
          'Type a line (data), then <code>quit</code>: step through the 4-way close <code>FIN → ACK → FIN → ACK</code>',
          'Right after closing run <code>netstat</code>: <code>TIME_WAIT</code> lingers for 2MSL',
          'Try <code>http 192.168.1.20</code>: handshake → GET → response → server-initiated close. Disable HTTP on the server and retry to see <code>RST</code> (refused)',
        ],
      },
      build() {
        const sw = NS.createDevice('switch', 400, 240);
        const pc1 = NS.createDevice('pc', 140, 150);
        const srv = NS.createDevice('server', 140, 340);
        NS.connectDevices(pc1, sw); NS.connectDevices(srv, sw);
        cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
        cfg(srv, 'eth0', '192.168.1.20', '255.255.255.0');
      },
      checks: [
        { label: { zh: '服务器出现过 ESTABLISHED 连接', en: 'An ESTABLISHED connection appeared on the server' },
          run(done) {
            const srv = [...NS.world.devices.values()].find(d => d.type === 'server');
            done(!!(srv && srv._tcpHist && srv._tcpHist.established >= 1));
          } },
        { label: { zh: '至少一条连接通过 FIN 挥手完整关闭', en: 'At least one connection closed cleanly via FIN' },
          run(done) {
            const srv = [...NS.world.devices.values()].find(d => d.type === 'server');
            done(!!(srv && srv._tcpHist && srv._tcpHist.finClosed >= 1));
          } },
      ],
    },

    {
      id: 'lab-trouble',
      title: { zh: '实验 5 · 网络故障排查', en: 'Lab 5 · Troubleshooting' },
      desc: { zh: '网络"不通"了——用 ipconfig / ping / tracert 等命令定位并修复两处故障。',
              en: 'The network is down — use ipconfig / ping / tracert to locate and fix two faults.' },
      answer: {
        zh: '故障 1：PC2 的子网掩码被错误配置为 255.255.0.0（应为 255.255.255.0）。<br>故障 2：Switch2 与 PC2 之间的链路被断开（点击该链路恢复）。',
        en: 'Fault 1: PC2 has the wrong mask 255.255.0.0 (should be 255.255.255.0).<br>Fault 2: the Switch2–PC2 link is down (click it to restore).',
      },
      goals: {
        zh: [
          '需求：PC1（192.168.1.10）必须能 ping 通 PC2（192.168.2.10）',
          '排查思路：先 <code>ping</code> 看现象 → <code>ipconfig</code> 检查本机配置 → <code>tracert</code> 定位断点 → 检查链路状态',
          '共 <b>2 处</b>故障：一处配置错误、一处链路断开（画布上断开的链路显示为红色虚线）',
          '修好后用实验室面板的【验证】按钮验收；卡住了可以点【显示答案】',
        ],
        en: [
          'Goal: PC1 (192.168.1.10) must ping PC2 (192.168.2.10)',
          'Method: <code>ping</code> to observe → <code>ipconfig</code> to check local config → <code>tracert</code> to find the break → check link state',
          'There are <b>2</b> faults: one misconfiguration and one downed link (red dashed line on canvas)',
          'Verify with the check button; use "Show answer" if stuck',
        ],
      },
      build() {
        const pc1 = NS.createDevice('pc', 90, 240);
        const sw1 = NS.createDevice('switch', 240, 240);
        const r1 = NS.createDevice('router', 400, 240);
        const sw2 = NS.createDevice('switch', 560, 240);
        const pc2 = NS.createDevice('pc', 710, 240);
        NS.connectDevices(pc1, sw1); NS.connectDevices(sw1, r1); NS.connectDevices(r1, sw2); NS.connectDevices(sw2, pc2);
        cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0', '192.168.1.1');
        cfg(r1, 'ge0/0', '192.168.1.1', '255.255.255.0');
        cfg(r1, 'ge0/1', '192.168.2.1', '255.255.255.0');
        /* 故障 1：PC2 掩码配错 */
        cfg(pc2, 'eth0', '192.168.2.10', '255.255.0.0', '192.168.2.1');
        /* 故障 2：末段链路断开 */
        const lastLink = [...NS.world.links.values()].find(l => {
          const [e1, e2] = l.endpoints();
          return (e1.dev === pc2 || e2.dev === pc2);
        });
        if (lastLink) lastLink.up = false;
      },
      checks: [
        { label: { zh: 'PC1 → 192.168.2.10 ping 连通（两处故障均已修复）', en: 'PC1 → 192.168.2.10 ping succeeds (both faults fixed)' },
          run(done) {
            const pc1 = [...NS.world.devices.values()].find(d => d.name === 'PC1');
            if (!pc1) return done(false);
            pingCheck(pc1, '192.168.2.10')(done);
          } },
      ],
    },
  ];

  const Labs = {
    active: null,

    init() {
      NS.I18N.onChange(() => { this.renderList(); this.renderActive(); });
      this.renderList();
    },

    renderList() {
      const box = document.getElementById('labs-list');
      box.innerHTML = '';
      LABS.forEach(lab => {
        const item = document.createElement('div');
        item.className = 'lab-item';
        item.innerHTML = `<h4>${lab.title[NS.I18N.lang === 'zh' ? 'zh' : 'en']}</h4><p>${lab.desc[NS.I18N.lang === 'zh' ? 'zh' : 'en']}</p>`;
        const b = document.createElement('button');
        b.className = 'lab-load';
        b.textContent = NS.I18N.lang === 'zh' ? '加载实验' : 'Load lab';
        b.addEventListener('click', () => this.load(lab.id));
        item.appendChild(b);
        box.appendChild(item);
      });
    },

    load(id) {
      const lab = LABS.find(l => l.id === id);
      if (!lab) return;
      this.active = lab;
      NS.world.clear();                 /* 实验替换整个拓扑，必须先清空 */
      lab.build();
      NS.Canvas.select(null);
      NS.toast && NS.toast(NS.t('toast.labLoad') + ' · ' + pick(lab.title), 'ok');
      this.renderActive();
      document.getElementById('labs-panel').classList.remove('collapsed');
    },

    renderActive() {
      const box = document.getElementById('labs-list');
      const exist = document.getElementById('lab-active');
      if (exist) exist.remove();
      const lab = this.active;
      if (!lab) return;
      const div = document.createElement('div');
      div.id = 'lab-active';
      const goals = pick(lab.goals).map(g => `<li>${g}</li>`).join('');
      div.innerHTML = `<h3>${pick(lab.title)}</h3><div class="lab-goal"><ol style="padding-left:0;list-position:inside;">${goals}</ol></div>`;

      const actions = document.createElement('div');
      actions.className = 'lab-actions';
      const chk = document.createElement('button');
      chk.textContent = NS.I18N.lang === 'zh' ? '✓ 验证' : '✓ Verify';
      chk.addEventListener('click', () => this.runChecks());
      actions.appendChild(chk);
      if (lab.answer) {
        const ans = document.createElement('button');
        ans.textContent = NS.I18N.lang === 'zh' ? '显示答案' : 'Show answer';
        ans.addEventListener('click', () => {
          NS.toast && NS.toast(pick(lab.answer), 'warn', 9000);
        });
        actions.appendChild(ans);
      }
      const back = document.createElement('button');
      back.textContent = NS.I18N.lang === 'zh' ? '返回列表' : 'Back';
      back.addEventListener('click', () => { this.active = null; this.renderActive(); this.renderList(); });
      actions.appendChild(back);
      div.appendChild(actions);

      const checks = document.createElement('div');
      checks.id = 'lab-checks';
      div.appendChild(checks);
      box.prepend(div);
    },

    runChecks() {
      const lab = this.active;
      const box = document.getElementById('lab-checks');
      if (!lab || !box) return;
      box.innerHTML = '';
      NS.SimLoop.play();
      const queue = lab.checks.slice();
      const next = () => {
        if (!queue.length) return;
        const c = queue.shift();
        const row = document.createElement('div');
        row.className = 'lab-check';
        row.innerHTML = `<span class="mark">…</span><span>${pick(c.label)}</span>`;
        box.appendChild(row);
        const mark = row.querySelector('.mark');
        try {
          c.run((pass) => {
            row.classList.add(pass ? 'ok' : 'bad');
            mark.textContent = pass ? '✓' : '✗';
            setTimeout(next, 300);
          });
        } catch (e) { console.error(e); row.classList.add('bad'); mark.textContent = '✗'; next(); }
      };
      next();
    },
  };

  NS.Labs = Labs;
  NS.LABS = LABS;
})(typeof window !== 'undefined' ? window : globalThis);
