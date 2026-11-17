/* ═══════════════ labs.js — 预置实验场景 ═══════════════
 * 每个实验 = 拓扑构建 + 双语任务目标 + 自动验收检查（部分）+ 参考答案。
 */
(function (root) {
  const NS = root.NS = root.NS || {};
  const pick = (o) => (NS.I18N.lang === 'zh' ? o.zh : o.en);

  function cfg(dev, ifName, ip, mask, gw) { dev.setIfConfig(ifName, { ip, mask, gw: gw || '' }); }

  /* ping 型验收 */
  function pingCheck(from, targetIp, done, expectedResponder) {
    return NS.Proto.icmpEcho(from, targetIp, { timeout: 3000, expectedResponder }, res => done(res.kind === 'reply'));
  }

  function sameSubnetPCs() {
    const [a, b] = [...NS.world.devices.values()].filter(d => d.type === 'pc');
    const source = a?.interfaces[0], target = b?.interfaces[0];
    const IP = NS.IP;
    if (!source || !target || source.ip === target.ip) return null;
    if (!IP.validUnicast(source.ip) || !IP.validUnicast(target.ip)) return null;
    if (!IP.inSubnet(source.ip, target.ip, source.mask) || !IP.inSubnet(source.ip, target.ip, target.mask)) return null;
    return { a, b, target };
  }

  const LABS = [
    /* ════════ 第二单元 · 两课时实验（配套《第二单元实验手册》）════════ */
    {
      id: 'unit2-1',
      group: 'unit2',
      title: { zh: '课时 1 · 实验一　查看与配置 IP 地址', en: 'Period 1 · Lab 1: Inspect & configure IP' },
      desc: { zh: '（手册课时 1）双击设备开终端，用 ipconfig 观察未配置状态，再在属性面板配置同网段地址；测试非法地址。',
              en: '(Manual P1) Inspect with ipconfig, configure same-subnet addresses, test an invalid address.' },
      goals: {
        zh: [
          '双击 <code>PC1</code> 打开终端，执行 <code>ipconfig</code>，记录"未配置"时的显示',
          '单击 PC1，在右侧属性面板配置 <code>192.168.1.10 / 255.255.255.0</code>；为 <code>PC2</code> 配置 <code>192.168.1.20</code>，再次 <code>ipconfig</code> 对比',
          '把 PC1 的 IP 改成 <code>192.168.1.260</code>，观察系统提示（地址不合法），再改回 <code>192.168.1.10</code>',
          '执行 <code>ipconfig /all</code>，找到并记录 PC1 网卡的<b>物理地址（MAC）</b>',
          '完成记录单后点击【验证】（本实验的 ping 测试在下一个实验进行）',
        ],
        en: [
          'Double-click <code>PC1</code>, run <code>ipconfig</code> and note the "not configured" state',
          'Configure <code>PC1</code> with <code>192.168.1.10/255.255.255.0</code> and <code>PC2</code> with <code>192.168.1.20</code>, then compare <code>ipconfig</code> again',
          'Try setting PC1 to <code>192.168.1.260</code> and observe the invalid-address warning; restore <code>192.168.1.10</code>',
          'Run <code>ipconfig /all</code> and record PC1\'s <b>MAC address</b>',
          'Fill in your worksheet, then press Verify (the ping test is the next lab)',
        ],
      },
      build() {
        const sw = NS.createDevice('switch', 400, 240);
        const pc1 = NS.createDevice('pc', 160, 150);
        const pc2 = NS.createDevice('pc', 160, 330);
        NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw);
      },
      checks: [
        { label: { zh: '两台 PC 已配置同网段合法 IP', en: 'Both PCs configured with valid same-subnet IPs' },
          run(done) { done(Boolean(sameSubnetPCs())); } },
      ],
    },

    {
      id: 'unit2-2',
      group: 'unit2',
      title: { zh: '课时 1 · 实验二　ping 连通测试与 ARP', en: 'Period 1 · Lab 2: ping & ARP' },
      desc: { zh: '（手册课时 1）ping 检测连通；观察"ping 之前先 ARP"——黄色广播包先行，抓包逐层解码，arp -a 对照。',
              en: '(Manual P1) Test connectivity with ping; watch ARP-before-ping via the sniffer and arp -a.' },
      goals: {
        zh: [
          '点击底部【抓包】页签，确认捕获点为<b>所有链路</b>',
          '在 PC1 执行 <code>ping 192.168.1.20</code>：观察终端回复（字节/时间/TTL）与画布上先飞过的<b>黄色 ARP 广播</b>',
          '在抓包列表点击<b>第一条 ARP 报文</b>，右侧逐层解码中找到"目标 MAC: FF:FF:FF:FF:FF:FF（广播）"',
          '在 PC1 执行 <code>arp -a</code>，记录 192.168.1.20 对应的物理地址，与实验一记录的 PC2 MAC 对照',
          '在 PC2 上执行 <code>ping 192.168.1.10</code>（反向测试），然后点击【验证】',
        ],
        en: [
          'Open the Sniffer tab with capture point = all links',
          'From PC1 run <code>ping 192.168.1.20</code>: watch the reply line and the <b>yellow ARP broadcast</b> flying first',
          'Click the first ARP frame and find "Destination MAC: FF:FF:FF:FF:FF:FF (Broadcast)" in the decode view',
          'Run <code>arp -a</code> on PC1; compare the MAC for 192.168.1.20 with PC2\'s MAC from Lab 1',
          'Run <code>ping 192.168.1.10</code> on PC2 (reverse test), then press Verify',
        ],
      },
      build() {
        const sw = NS.createDevice('switch', 400, 240);
        const pc1 = NS.createDevice('pc', 160, 150);
        const pc2 = NS.createDevice('pc', 160, 330);
        NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw);
        cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
        cfg(pc2, 'eth0', '192.168.1.20', '255.255.255.0');
      },
      checks: [
        { label: { zh: 'PC1 的 ARP 缓存已学到 PC2', en: 'PC1 ARP cache learned PC2' },
          run(done) {
            const pc1 = [...NS.world.devices.values()].find(d => d.name === 'PC1');
            const cache = pc1 && pc1.arpCaches && pc1.arpCaches.get('eth0');
            done(Boolean(cache && cache.has('192.168.1.20')));
          } },
        { label: { zh: 'PC1 → PC2 ping 连通', en: 'PC1 → PC2 ping succeeds' },
          run(done) {
            const st = sameSubnetPCs();
            if (!st) return done(false);
            pingCheck(st.a, st.b.interfaces[0].ip, done);
          } },
      ],
    },

    {
      id: 'unit2-3',
      group: 'unit2',
      title: { zh: '课时 1 · 实验三　默认网关与 tracert 路径追踪', en: 'Period 1 · Lab 3: default gateway & tracert' },
      desc: { zh: '（手册课时 1）ipconfig 找默认网关，tracert 数跳数；断开中间链路观察超时，再恢复。',
              en: '(Manual P1) Find the default gateway, count hops with tracert; break the middle link and watch timeouts.' },
      answer: {
        zh: '断开 R1—R2 后：tracert 第 1 跳（192.168.1.1）仍正常应答，从第 2 跳起显示"请求超时"。恢复方法：单击该链路 → 属性面板 → 连通。',
        en: 'After breaking R1—R2: hop 1 (192.168.1.1) still answers; from hop 2 on you get timeouts. Restore: click the link → inspector → Up.',
      },
      goals: {
        zh: [
          '双击 <code>PC1</code> 执行 <code>ipconfig</code>，找到<b>默认网关</b>一行——它就是通信经过的第一个路由器',
          '执行 <code>tracert 192.168.2.10</code>，数出经过的路由器数量（不含本机与目标），注意每行的 3 个时间值',
          '单击画布上 <b>Router1—Router2 之间的链路</b>，在属性面板点击<b>断开</b>；再次 tracert，观察第 1 跳正常、之后"请求超时"',
          '把链路<b>恢复连通</b>，在 Router1 终端执行 <code>show ip route</code> 查看路由表，然后点击【验证】',
        ],
        en: [
          'On <code>PC1</code> run <code>ipconfig</code> and locate the <b>default gateway</b> line — the first router on the path',
          'Run <code>tracert 192.168.2.10</code>; count the routers on the way and the 3 time columns per line',
          'Click the <b>Router1—Router2 link</b>, set it <b>down</b> in the inspector; tracert again — hop 1 answers, then timeouts',
          'Restore the link, run <code>show ip route</code> on Router1, then press Verify',
        ],
      },
      build() {
        const pc1 = NS.createDevice('pc', 90, 240);
        const r1 = NS.createDevice('router', 300, 240);
        const r2 = NS.createDevice('router', 520, 240);
        const pc2 = NS.createDevice('pc', 730, 240);
        NS.connectDevices(pc1, r1); NS.connectDevices(r1, r2); NS.connectDevices(r2, pc2);
        cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0', '192.168.1.1');
        cfg(r1, 'ge0/0', '192.168.1.1', '255.255.255.0');
        cfg(r1, 'ge0/1', '10.0.0.1', '255.255.255.252');
        cfg(r2, 'ge0/0', '10.0.0.2', '255.255.255.252');
        cfg(r2, 'ge0/1', '192.168.2.1', '255.255.255.0');
        cfg(pc2, 'eth0', '192.168.2.10', '255.255.255.0', '192.168.2.1');
        r1.addRoute('192.168.2.0', '255.255.255.0', '10.0.0.2');   /* 路由已配好，tracert 开箱即用 */
        r2.addRoute('192.168.1.0', '255.255.255.0', '10.0.0.1');
      },
      checks: [
        { label: { zh: '链路已恢复且 PC1 → 192.168.2.10 路径连通', en: 'Link restored; PC1 → 192.168.2.10 reachable' },
          run(done) {
            const pc1 = [...NS.world.devices.values()].find(d => d.name === 'PC1');
            if (!pc1) return done(false);
            pingCheck(pc1, '192.168.2.10', done);
          } },
      ],
    },

    {
      id: 'unit2-4',
      group: 'unit2',
      title: { zh: '课时 2 · 实验四　netstat 与 TCP 三次握手', en: 'Period 2 · Lab 4: netstat & TCP handshake' },
      desc: { zh: '（手册课时 2）telnet 建立连接，从服务器侧 netstat 看 ESTABLISHED；抓包逐层解码三次握手；单步慢放重演。',
              en: '(Manual P2) Establish a session, watch ESTABLISHED via netstat on the server; decode the handshake in the sniffer.' },
      goals: {
        zh: [
          'PC1 执行 <code>netstat -an</code>：此时没有任何 PC1 的连接',
          '执行 <code>telnet 192.168.1.20</code>，随意发一句话（注意：会话期间终端输入都发给服务器，不能再执行命令）',
          '<b>双击 Server1</b>，在服务器终端执行 <code>netstat -an</code>：记录 ESTABLISHED 行的本地/外部地址与端口',
          '打开【抓包】面板，依次点击前三条 TCP 报文，展开 Ethernet II → IP → TCP 三层，记录 SYN / SYN·ACK / ACK',
          '进阶：⏸ 暂停后重新 telnet，连按 ⏭ 单步逐帧重演握手；输入 <code>quit</code> 后立即在 PC1 执行 <code>netstat -an</code> 看 <b>TIME_WAIT</b>',
        ],
        en: [
          'On PC1 run <code>netstat -an</code>: no connections yet',
          'Run <code>telnet 192.168.1.20</code> and send a line (during the session the terminal input goes to the server)',
          '<b>Double-click Server1</b> and run <code>netstat -an</code> there: record the ESTABLISHED local/foreign addresses',
          'In the Sniffer, click the first three TCP frames and expand Ethernet II → IP → TCP; record SYN / SYN·ACK / ACK',
          'Advanced: pause (⏸), redo telnet and step (⏭) through the handshake; after <code>quit</code>, run <code>netstat -an</code> on PC1 to see <b>TIME_WAIT</b>',
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
        { label: { zh: '会话已通过 quit 完整关闭（挥手完成）', en: 'Session closed cleanly via quit (FIN close)' },
          run(done) {
            const srv = [...NS.world.devices.values()].find(d => d.type === 'server');
            done(!!(srv && srv._tcpHist && srv._tcpHist.finClosed >= 1));
          } },
      ],
    },

    {
      id: 'unit2-5',
      group: 'unit2',
      title: { zh: '课时 2 · 实验五　综合组网：校园直播网络', en: 'Period 2 · Lab 5: build a campus live-streaming network' },
      desc: { zh: '（手册课时 2）按需求从零搭建双房间直播网络：选设备、连线、规划地址、配置参数，用 ping/http 验收。',
              en: '(Manual P2) Build the two-room streaming network from scratch: devices, links, addressing, verify with ping/http.' },
      answer: {
        zh: '参考方案：A 房 PC0（192.168.10.10/24）+ Server1（192.168.10.20/24，静态）+ PC1（192.168.10.11/24）— Switch1 — Router1（ge0/0: 192.168.10.1，ge0/1: 192.168.20.1）— Switch2 — PC2（192.168.20.10/24，网关 192.168.20.1）。A 房设备网关指向 192.168.10.1。',
        en: 'Reference: Room A PC0 (192.168.10.10/24), Server1 (192.168.10.20/24 static), PC1 (192.168.10.11/24) — Switch1 — Router1 (ge0/0: 192.168.10.1, ge0/1: 192.168.20.1) — Switch2 — PC2 (192.168.20.10/24, gw 192.168.20.1). Room A hosts use gateway 192.168.10.1.',
      },
      goals: {
        zh: [
          '<b>需求</b>：A 房间有推流机 PC0 和直播服务器 Server1；B 房间有两台观看 PC（其中一台命名 PC2）。两房间为独立网段，经一台路由器互联',
          '地址规划：A 网段用 <code>192.168.10.0/24</code>，B 网段用 <code>192.168.20.0/24</code>（自拟每台设备地址并填入记录单）',
          '放置设备并连线；为所有设备配置 IP/掩码；路由器两个接口分别作两网段网关；PC 配置默认网关；服务器用<b>静态</b>地址',
          '验收：PC2 <code>ping</code> 服务器 → 通；PC2 <code>tracert</code> 服务器 → 记录跳数；Server1 <code>netstat -an</code> → 80 端口 LISTENING；PC0 <code>http 服务器IP</code> → HTTP/1.1 200 OK',
          '拓展：与同伴互相制造一处故障（断链/改错掩码或网关），用 ping、ipconfig、tracert 定位修复后，点击【验证】',
        ],
        en: [
          '<b>Requirement</b>: Room A has streamer PC0 and Server1; Room B has two viewer PCs (name one PC2). Two subnets joined by one router',
          'Addressing: room A <code>192.168.10.0/24</code>, room B <code>192.168.20.0/24</code> (assign each host an address and fill in your worksheet)',
          'Place & link devices; configure IP/mask on everything; the router serves as both gateways; servers use <b>static</b> addresses',
          'Acceptance: PC2 <code>ping</code> server (ok), <code>tracert</code> (record hops), Server1 <code>netstat -an</code> (80 LISTENING), PC0 <code>http server</code> (200 OK)',
          'Extension: swap a hidden fault with a partner (broken link / wrong mask or gateway), locate it with ping / ipconfig / tracert, then press Verify',
        ],
      },
      build() { /* 学生从零搭建，本实验不预置拓扑 */ },
      checks: [
        { label: { zh: '拓扑规模满足需求（≥5 台设备，含服务器/路由器/≥2 台 PC）', en: 'Topology meets the requirement (≥5 devices incl. server, router, ≥2 PCs)' },
          run(done) {
            const ds = [...NS.world.devices.values()];
            const has = (t) => ds.filter(d => d.type === t).length;
            done(ds.length >= 5 && has('server') >= 1 && has('router') >= 1 && has('pc') >= 2);
          } },
        { label: { zh: '跨网段直播链路打通（不同网段的 PC 能 ping 通服务器）', en: 'Cross-subnet streaming path works (a PC in another subnet reaches the server)' },
          run(done) {
            const srv = [...NS.world.devices.values()].find(d => d.type === 'server' && d.interfaces[0].ip);
            if (!srv) return done(false);
            const IP = NS.IP;
            const pc = [...NS.world.devices.values()].find(d =>
              d.type === 'pc' && d.interfaces[0].ip && d.interfaces[0].mask &&
              !IP.inSubnet(d.interfaces[0].ip, srv.interfaces[0].ip, d.interfaces[0].mask));
            if (!pc) return done(false);
            pingCheck(pc, srv.interfaces[0].ip, done);
          } },
      ],
    },

    /* ════════ 基础练习 ════════ */
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
          run(done) { done(Boolean(sameSubnetPCs())); },
        },
        {
          label: { zh: 'PC1 → PC2 ping 连通', en: 'PC1 → PC2 ping succeeds' },
          run(done) {
            const pair = sameSubnetPCs();
            if (!pair || !pair.a.on || !pair.b.on) return done(false);
            return pingCheck(pair.a, pair.target.ip, done, pair.b);
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
            return pingCheck(pc1, '192.168.2.10', done);
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
            done(!!(sw && NS.Proto.macEntries(sw).length >= 3));
          } },
        { label: { zh: 'PC1 的 ARP 缓存中有 PC2 与 PC3', en: 'PC1 ARP cache has PC2 and PC3' },
          run(done) {
            const pc1 = [...NS.world.devices.values()].find(d => d.name === 'PC1');
            if (!pc1) return done(false);
            done(Boolean(NS.Proto.arpLookup(pc1, 'eth0', '192.168.1.20') && NS.Proto.arpLookup(pc1, 'eth0', '192.168.1.30')));
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
          '单击 <code>PC1</code> 或服务器，在右侧属性面板的 TCP 连接表观察 <code>SYN_SENT</code>、<code>SYN_RCVD</code> 和 <code>ESTABLISHED</code> 状态',
          '输入任意文字回车（作为数据发送），再输入 <code>quit</code> 断开：单步观察四次挥手 <code>FIN → ACK → FIN → ACK</code>',
          '断开后立即在 PC1 执行 <code>netstat</code>：还能看到 <code>TIME_WAIT</code> 状态（等待 2MSL 后才彻底关闭）',
          '再试 <code>http 192.168.1.20</code> 观察完整流程：握手 → GET → 响应 → 服务器主动挥手；把服务器 HTTP 服务关掉重试，观察 <code>RST</code>（连接被拒绝）',
        ],
        en: [
          'Pause the sim (⏸), then run <code>telnet 192.168.1.20</code> on <code>PC1</code> and press <b>step (⏭)</b> repeatedly: watch <code>SYN → SYN·ACK → ACK</code>',
          'Select <code>PC1</code> or the server to watch <code>SYN_SENT</code>, <code>SYN_RCVD</code> and <code>ESTABLISHED</code> in the inspector’s TCP table',
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
            return pingCheck(pc1, '192.168.2.10', done);
          } },
      ],
    },
  ];

  const topologySignature = ({ devices, links }) => JSON.stringify({ devices, links });

  const Labs = {
    active: null,
    builtSnapshot: null,
    _checkRun: null,

    init() {
      NS.I18N.onChange(() => { this.renderList(); this.renderActive(); });
      NS.Bus.on('world:cleared', () => {
        this.active = null;
        this.builtSnapshot = null;
        this.renderActive();
      });
      this.renderList();
    },

    isPristineTopology(topology) {
      return this.builtSnapshot === topologySignature(topology);
    },

    renderList() {
      const box = document.getElementById('labs-list');
      box.replaceChildren();
      const GROUPS = {
        unit2: { zh: '📗 第二单元 · 两课时实验（配套实验手册）', en: '📗 Unit 2 · Two-period labs (from the lab manual)' },
        basic: { zh: '📘 基础练习', en: '📘 Basic practice' },
      };
      const zh = NS.I18N.lang === 'zh';
      Object.keys(GROUPS).forEach(g => {
        const labs = LABS.filter(l => (l.group || 'basic') === g);
        if (!labs.length) return;
        const h = document.createElement('div');
        h.className = 'lab-group-title';
        h.textContent = zh ? GROUPS[g].zh : GROUPS[g].en;
        box.appendChild(h);
        labs.forEach(lab => {
          const item = document.createElement('div');
          item.className = 'lab-item';
          item.innerHTML = `<h4>${lab.title[zh ? 'zh' : 'en']}</h4><p>${lab.desc[zh ? 'zh' : 'en']}</p>`;
          const b = document.createElement('button');
          b.className = 'lab-load';
          b.textContent = zh ? '加载实验' : 'Load lab';
          b.addEventListener('click', () => this.load(lab.id));
          item.appendChild(b);
          box.appendChild(item);
        });
      });
    },

    load(id) {
      const lab = LABS.find(l => l.id === id);
      if (!lab || !NS.App.confirmReplacement('toast.confirmLab')) return;
      NS.world.clear();                 /* 实验替换整个拓扑，必须先清空 */
      lab.build();
      this.active = lab;
      this.builtSnapshot = topologySignature(NS.saveTopology());
      NS.toast && NS.toast(NS.t('toast.labLoad') + ' · ' + pick(lab.title), 'ok');
      this.renderActive();
      document.getElementById('labs-panel').classList.toggle('collapsed', window.matchMedia('(max-width: 1080px)').matches);
    },

    renderActive() {
      this.stopChecks();
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
      chk.id = 'lab-verify';
      chk.textContent = NS.I18N.lang === 'zh' ? '✓ 验证' : '✓ Verify';
      chk.addEventListener('click', () => this.runChecks());
      actions.appendChild(chk);
      if (lab.answer) {
        const ans = document.createElement('button');
        ans.textContent = NS.I18N.lang === 'zh' ? '显示答案' : 'Show answer';
        ans.addEventListener('click', () => {
          NS.toast && NS.toast(pick(lab.answer).replace(/<br\s*\/?>/gi, '\n'), 'warn', 9000);
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

    stopChecks() {
      const run = this._checkRun;
      if (!run) return;
      this._checkRun = null;
      clearTimeout(run.timer);
      run.cancel?.();
      run.button.disabled = false;
    },

    runChecks() {
      if (this._checkRun) return;
      const lab = this.active;
      const box = document.getElementById('lab-checks');
      const button = document.getElementById('lab-verify');
      if (!lab || !box || !button || !lab.checks.length) return;
      const run = { button, timer: null, cancel: null };
      this._checkRun = run;
      button.disabled = true;
      box.replaceChildren();
      NS.SimLoop.play();
      const queue = lab.checks.slice();
      const next = () => {
        if (this._checkRun !== run) return;
        const c = queue.shift();
        const row = document.createElement('div');
        row.className = 'lab-check';
        row.innerHTML = `<span class="mark">…</span><span>${pick(c.label)}</span>`;
        box.appendChild(row);
        const mark = row.querySelector('.mark');
        const done = (pass) => {
          if (this._checkRun !== run) return;
          run.cancel = null;
          row.classList.add(pass ? 'ok' : 'bad');
          mark.textContent = pass ? '✓' : '✗';
          if (queue.length) run.timer = setTimeout(next, 300);
          else this.stopChecks();
        };
        try {
          run.cancel = c.run(done);
        } catch (e) { console.error(e); done(false); }
      };
      next();
    },
  };

  NS.Labs = Labs;
  NS.LABS = LABS;
})(typeof window !== 'undefined' ? window : globalThis);
