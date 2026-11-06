#!/usr/bin/env node
/* ═══════════ tests/run.js — 引擎自动化测试（无 DOM） ═══════════
 * 用法: node tests/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 以全局作用域加载脚本（与浏览器 <script> 等价） */
['i18n.js', 'engine.js', 'protocols.js', 'devices.js', 'commands.js', 'labs.js'].forEach(f => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  (0, eval)(code);
});
const NS = globalThis.NS;

let pass = 0, fail = 0;
const results = [];
function assert(cond, msg) {
  if (cond) { pass++; results.push(`  ✓ ${msg}`); }
  else { fail++; results.push(`  ✗ ${msg}`); }
}
function section(name) { results.push(`\n■ ${name}`); }
const cfg = (dev, ifn, ip, mask, gw) => dev.setIfConfig(ifn, { ip, mask, gw: gw || '' });
const runtimeErrors = [];
const originalConsoleError = console.error;
console.error = (...args) => { runtimeErrors.push(args); originalConsoleError(...args); };

/* ─────────── 测试 1：同网段 ping（含 ARP 先行） ─────────── */
section('T1 同网段 ping（ARP → ICMP）');
NS.world.clear();
{
  const sw = NS.createDevice('switch', 100, 100);
  const pc1 = NS.createDevice('pc', 0, 0);
  const pc2 = NS.createDevice('pc', 200, 0);
  NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw);
  cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
  cfg(pc2, 'eth0', '192.168.1.20', '255.255.255.0');

  let res = null;
  NS.Proto.icmpEcho(pc1, '192.168.1.20', { echoId: 1 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);

  assert(res && res.kind === 'reply', `ping 收到回复 (got ${res && res.kind})`);
  assert(res && res.ms > 0, `往返时间 > 0 (${res && res.ms}ms)`);
  const arp = NS.Proto.arpLookup(pc1, 'eth0', '192.168.1.20');
  assert(!!arp, 'PC1 ARP 缓存已学到 PC2');
  assert(arp === pc2.interfaces[0].mac, 'ARP 解析的 MAC 正确');
  assert(sw.macTable.size >= 2, `交换机学习到 ≥2 条 MAC (got ${sw.macTable.size})`);
}

/* ─────────── 测试 2：对端关机 → 超时 ─────────── */
section('T2 对端关机 → Request timed out');
{
  const pcs = [...NS.world.devices.values()].filter(d => d.type === 'pc');
  pcs[1].power(false);
  let res = null;
  NS.Proto.icmpEcho(pcs[0], '192.168.1.20', { echoId: 2 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'timeout', `无 ARP 应答 → 超时 (got ${res && res.kind})`);
  pcs[1].power(true);
}

/* ─────────── 测试 3：跨路由器（静态路由 / 缺路由 / tracert 原理） ─────────── */
section('T3 跨路由器路由');
NS.world.clear();
{
  const pc1 = NS.createDevice('pc', 0, 0);
  const r1 = NS.createDevice('router', 100, 0);
  const r2 = NS.createDevice('router', 200, 0);
  const pc2 = NS.createDevice('pc', 300, 0);
  NS.connectDevices(pc1, r1); NS.connectDevices(r1, r2); NS.connectDevices(r2, pc2);
  cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0', '192.168.1.1');
  cfg(r1, 'ge0/0', '192.168.1.1', '255.255.255.0');
  cfg(r1, 'ge0/1', '10.0.0.1', '255.255.255.252');
  cfg(r2, 'ge0/0', '10.0.0.2', '255.255.255.252');
  cfg(r2, 'ge0/1', '192.168.2.1', '255.255.255.0');
  cfg(pc2, 'eth0', '192.168.2.10', '255.255.255.0', '192.168.2.1');

  /* 3a: 无路由 → 不可达(code 0 来自 R1) */
  let res = null;
  NS.Proto.icmpEcho(pc1, '192.168.2.10', { echoId: 3 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'unreachable' && res.from === '192.168.1.1',
    `缺路由 → R1 回不可达 (got ${res && res.kind} from ${res && res.from})`);

  /* 3b: 只加去程路由 → 回程丢（超时） */
  r1.addRoute('192.168.2.0', '255.255.255.0', '10.0.0.2');
  res = null;
  NS.Proto.icmpEcho(pc1, '192.168.2.10', { echoId: 4 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'timeout', `单边路由 → 回程丢失超时 (got ${res && res.kind})`);

  /* 3c: 补齐回程路由 → 通 */
  r2.addRoute('192.168.1.0', '255.255.255.0', '10.0.0.1');
  res = null;
  NS.Proto.icmpEcho(pc1, '192.168.2.10', { echoId: 5 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'reply' && res.ttl === 126, `双向路由 → ping 通且 TTL=128-2 (got ${res && res.kind} ttl=${res && res.ttl})`);

  /* 3d: TTL=1 → R1 回 time exceeded（tracert 第 1 跳原理） */
  res = null;
  NS.Proto.icmpEcho(pc1, '192.168.2.10', { echoId: 6, ttl: 1 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'tlexceeded' && res.from === '192.168.1.1',
    `TTL=1 → R1 回 ICMP 超时 (got ${res && res.kind} from ${res && res.from})`);
}

/* ─────────── 测试 4：TCP 三次握手 / 四次挥手 / 状态机 ─────────── */
section('T4 TCP 握手与挥手');
NS.world.clear();
{
  const sw = NS.createDevice('switch', 100, 100);
  const pc = NS.createDevice('pc', 0, 0);
  const srv = NS.createDevice('server', 200, 0);
  NS.connectDevices(pc, sw); NS.connectDevices(srv, sw);
  cfg(pc, 'eth0', '192.168.1.10', '255.255.255.0');
  cfg(srv, 'eth0', '192.168.1.20', '255.255.255.0');

  const tcpFrames = [];
  const pcLink = [...NS.world.links.values()].find(l => { const [a, b] = l.endpoints(); return a.dev === pc || b.dev === pc; });
  NS.Bus.on('frame', (rec) => {
    const f = rec.frame;
    /* 同一段会跨多条链路各传输一次；只统计 PC 侧链路 */
    if (rec.linkId !== pcLink.id || f.eth.type !== 'IPv4' || f.payload.ip.proto !== 'TCP') return;
    const s = f.payload.payload;
    tcpFrames.push(s.flags.SYN && !s.flags.ACK ? 'SYN' : s.flags.SYN && s.flags.ACK ? 'SYNACK'
      : s.flags.FIN ? 'FIN' : s.flags.RST ? 'RST' : s.flags.PSH ? 'DATA' : 'ACK');
  });

  let opened = false, closed = false;
  const conn = NS.Proto.tcp.open(pc, '192.168.1.20', 23, {
    onOpen() { opened = true; },
    onClose() { closed = true; },
    onErr() {},
  });
  NS.Engine.advanceUntilIdle(20000);
  assert(opened, 'telnet 建连成功（三次握手完成）');
  assert(conn.state === 'ESTABLISHED', `客户端 ESTABLISHED (got ${conn.state})`);
  const first3 = tcpFrames.slice(0, 3).join(',');
  assert(first3 === 'SYN,SYNACK,ACK', `握手顺序 SYN→SYN·ACK→ACK (got ${first3})`);
  const srvConn = NS.Proto.tcp.connsOf(srv)[0];
  assert(srvConn && srvConn.state === 'ESTABLISHED', '服务器侧连接 ESTABLISHED');
  assert(NS.Proto.tcp.historyOf(srv).established >= 1, '服务器握手历史计数');

  /* 发数据 → 回显 */
  NS.Proto.tcp.send(conn, 'hello\r\n');
  NS.Engine.advanceUntilIdle(20000);
  assert(tcpFrames.includes('DATA'), '数据段已发送');
  let gotEcho = false;
  const pcIf = pc.interfaces[0].ip, srvIf = srv.interfaces[0].ip;
  NS.Sniffer ? null : null;
  /* 通过服务器连接的 ack 前进验证回显数据已被客户端确认 */
  const srvConn2 = NS.Proto.tcp.connsOf(srv)[0];
  gotEcho = srvConn2 && srvConn2.seq > 5000 + 72;   /* banner(72) 之后又有新数据发送 */
  assert(gotEcho, `服务器回显数据已发送 (srv seq=${srvConn2 && srvConn2.seq})`);

  /* 四次挥手 */
  NS.Proto.tcp.close(conn);
  NS.Engine.advanceUntilIdle(20000);
  const tail = tcpFrames.slice(-5).join(',');
  assert(/FIN,ACK,FIN,ACK|FIN,ACK/.test(tail), `挥手出现 FIN/ACK 序列 (tail=${tail})`);
  assert(conn.state === 'TIME_WAIT' || conn.state === 'CLOSED', `客户端进入 TIME_WAIT/CLOSED (got ${conn.state})`);

  /* TIME_WAIT 到期后完全关闭 */
  NS.Engine.advanceUntilIdle(30000);
  assert(!NS.Proto.tcp.connsOf(pc).includes(conn), 'TIME_WAIT 到期后连接清除');
  assert(NS.Proto.tcp.historyOf(srv).finClosed >= 1, '完整挥手关闭计数');
}

/* ─────────── 测试 5：端口未监听 → RST ─────────── */
section('T5 端口未监听 → RST');
NS.world.clear();
{
  const sw = NS.createDevice('switch', 100, 100);
  const pc = NS.createDevice('pc', 0, 0);
  const srv = NS.createDevice('server', 200, 0);
  NS.connectDevices(pc, sw); NS.connectDevices(srv, sw);
  cfg(pc, 'eth0', '192.168.1.10', '255.255.255.0');
  cfg(srv, 'eth0', '192.168.1.20', '255.255.255.0');
  srv.services = { http: false, telnet: false };
  srv.applyServices();

  let err = null;
  NS.Proto.tcp.open(pc, '192.168.1.20', 80, { onOpen() {}, onClose() {}, onErr(m) { err = m; } });
  NS.Engine.advanceUntilIdle(20000);
  assert(err === 'refused', `连接被拒 (got ${err})`);
}

/* ─────────── 测试 6：错误掩码 → 传输失败 ─────────── */
section('T6 错误掩码 / 无网关');
NS.world.clear();
{
  const sw = NS.createDevice('switch', 100, 100);
  const pc1 = NS.createDevice('pc', 0, 0);
  const pc2 = NS.createDevice('pc', 200, 0);
  NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw);
  cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
  cfg(pc2, 'eth0', '192.168.2.10', '255.255.0.0');       // PC2 掩码错误

  let res = null;
  NS.Proto.icmpEcho(pc1, '192.168.2.10', { echoId: 7 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'noroute', `PC1 视角异网段且无网关 → 传输失败 (got ${res && res.kind})`);

  /* PC2 视角（掩码 255.255.0.0 认为同网段）→ 发出 ARP 但无人应答 → 超时 */
  res = null;
  NS.Proto.icmpEcho(pc2, '192.168.1.10', { echoId: 8 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'timeout', `错误掩码 → ARP 无应答超时 (got ${res && res.kind})`);
}

/* ─────────── 测试 7：断链 → 超时；恢复后通 ─────────── */
section('T7 链路断开 / 恢复');
NS.world.clear();
{
  const sw = NS.createDevice('switch', 100, 100);
  const pc1 = NS.createDevice('pc', 0, 0);
  const pc2 = NS.createDevice('pc', 200, 0);
  NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw);
  cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
  cfg(pc2, 'eth0', '192.168.1.20', '255.255.255.0');
  const link = [...NS.world.links.values()][0];
  link.up = false;

  let res = null;
  NS.Proto.icmpEcho(pc1, '192.168.1.20', { echoId: 9 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'timeout', `断链 → 超时 (got ${res && res.kind})`);

  link.up = true;
  res = null;
  NS.Proto.icmpEcho(pc1, '192.168.1.20', { echoId: 10 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  assert(res && res.kind === 'reply', `恢复后 ping 通 (got ${res && res.kind})`);
}

/* ─────────── 测试 8：交换机泛洪 → 学习 → 定向转发 ─────────── */
section('T8 交换机泛洪与学习');
NS.world.clear();
{
  const sw = NS.createDevice('switch', 100, 100);
  const pc1 = NS.createDevice('pc', 0, 0);
  const pc2 = NS.createDevice('pc', 200, 0);
  const pc3 = NS.createDevice('pc', 100, 200);
  NS.connectDevices(pc1, sw); NS.connectDevices(pc2, sw); NS.connectDevices(pc3, sw);
  cfg(pc1, 'eth0', '192.168.1.10', '255.255.255.0');
  cfg(pc2, 'eth0', '192.168.1.20', '255.255.255.0');
  cfg(pc3, 'eth0', '192.168.1.30', '255.255.255.0');

  let flooded = 0;
  const off = NS.Bus.on('frame', (rec) => {
    if (rec.frame.eth.type === 'ARP' && rec.frame.payload.op === 1) flooded++;
  });
  let res = null;
  NS.Proto.icmpEcho(pc1, '192.168.1.20', { echoId: 11 }, (r) => { res = r; });
  NS.Engine.advanceUntilIdle(20000);
  off();
  assert(res && res.kind === 'reply', 'ping 通');
  assert(flooded >= 2, `ARP 广播被泛洪到 ≥2 个端口 (got ${flooded})`);
  assert(sw.macTable.size >= 2, `MAC 表学习 (got ${sw.macTable.size})`);
}

/* ─────────── 审查发现的问题回归 ─────────── */
function loadLab(id) {
  NS.world.clear();
  NS.LABS.find(lab => lab.id === id).build();
  return Object.fromEntries([...NS.world.devices.values()].map(dev => [dev.name, dev]));
}

function pingResult(dev, ip) {
  let result;
  NS.Proto.icmpEcho(dev, ip, { echoId: 500 }, res => { result = res; });
  NS.Engine.advanceUntilIdle(30000);
  return result;
}

function droppingFrames(shouldDrop, run) {
  const originalTx = NS.Net.tx;
  NS.Net.tx = function (dev, iface, frame) {
    if (shouldDrop(dev, frame)) return false;
    return originalTx.call(this, dev, iface, frame);
  };
  try { run(); } finally { NS.Net.tx = originalTx; }
}

section('T9 本机地址、回环和路由器多接口交付');
{
  const { PC1 } = loadLab('lab-route');
  let frames = 0;
  const off = NS.Bus.on('frame', () => frames++);
  for (const ip of ['192.168.1.10', '127.0.0.1', '127.0.0.2']) {
    const result = pingResult(PC1, ip);
    assert(result?.kind === 'reply' && result.from === ip, `本地 ping ${ip} 回复地址正确`);
  }
  assert(frames === 0, '本地通信不产生链路报文');
  off();
  const result = pingResult(PC1, '10.0.0.1');
  assert(result?.kind === 'reply' && result.from === '10.0.0.1', '路由器从另一接口收包也能本地交付');
  PC1.setIfConfig('eth0', { ip: '', mask: '', gw: '' });
  assert(pingResult(PC1, '127.0.0.1')?.kind === 'reply', '未配置网卡也能 ping 回环地址');
  assert(pingResult(PC1, '')?.kind === 'noroute', '未配置 IP 的实验目标不会被误判成本机地址');
}

section('T10 主机静态路由命令、转发和持久化');
{
  const { PC1, Router1, Router2 } = loadLab('lab-route');
  Router1.addRoute('192.168.2.0', '255.255.255.0', '10.0.0.2');
  Router2.addRoute('192.168.1.0', '255.255.255.0', '10.0.0.1');
  PC1.setIfConfig('eth0', { gw: '' });
  const output = [];
  const ctx = { dev: PC1, print: text => output.push(text) };
  NS.Commands.execute('route add 192.168.2.0 MASK 255.255.255.0 192.168.1.1', ctx);
  assert(PC1.staticRoutes.length === 1 && !output.join('').includes('出错'), 'PC route add 支持大小写 MASK');
  assert(pingResult(PC1, '192.168.2.10')?.kind === 'reply', 'PC 使用静态路由完成跨网段通信');
  const saved = NS.saveTopology();
  assert(NS.loadTopology(saved), '包含主机静态路由的拓扑可重新加载');
  const restored = NS.world.devices.get(PC1.id);
  assert(restored.staticRoutes.length === 1 && pingResult(restored, '192.168.2.10')?.kind === 'reply', '加载后主机静态路由仍生效');
  NS.Commands.execute('route delete 192.168.2.0', { ...ctx, dev: restored });
  assert(pingResult(restored, '192.168.2.10')?.kind === 'noroute', '删除主机静态路由后恢复无路由状态');
  const server = NS.createDevice('server', 0, 0);
  cfg(server, 'eth0', '172.16.0.10', '255.255.255.0');
  NS.Commands.execute('route add 10.0.0.0 mask 255.0.0.0 172.16.0.1', { ...ctx, dev: server });
  assert(NS.Proto.hostRoute(server, '10.1.2.3').nextHop === '172.16.0.1', '服务器支持静态路由');
}

section('T11 直连与静态路由统一最长前缀匹配');
{
  NS.world.clear();
  const router = NS.createDevice('router', 0, 0);
  cfg(router, 'ge0/0', '10.0.0.1', '255.0.0.0');
  cfg(router, 'ge0/1', '192.168.1.1', '255.255.255.0');
  router.addRoute('10.1.0.0', '255.255.0.0', '192.168.1.2');
  assert(NS.Proto.routerRoute(router, '10.1.0.10').nextHop === '192.168.1.2', '/16 静态路由优先于 /8 直连路由');
  assert(NS.Proto.routerRoute(router, '10.2.0.10').nextHop === '10.2.0.10', '其他地址仍走 /8 直连路由');
  router.addRouterInterface();
  cfg(router, 'ge0/2', '10.1.1.1', '255.255.255.0');
  assert(NS.Proto.routerRoute(router, '10.1.1.10').ifce.name === 'ge0/2', '/24 直连路由优先于 /16 静态路由');
}

section('T12 历史抓包保留各跳 TTL');
{
  const { PC1, Router1, Router2 } = loadLab('lab-route');
  Router1.addRoute('192.168.2.0', '255.255.255.0', '10.0.0.2');
  Router2.addRoute('192.168.1.0', '255.255.255.0', '10.0.0.1');
  const packets = [];
  const off = NS.Bus.on('frame', rec => {
    if (rec.frame.payload.payload?.type === 8) packets.push(rec.frame);
  });
  pingResult(PC1, '192.168.2.10');
  off();
  assert(packets.map(f => f.payload.ip.ttl).join(',') === '128,127,126', '通信结束后每跳 TTL 仍为 128、127、126');
  assert(new Set(packets.map(f => f.payload.ip.id)).size === 1, '逐跳转发保留同一 IP Identification');
}

section('T13 导入失败保持当前拓扑及运行状态');
{
  const { PC1 } = loadLab('lab-arp');
  const saved = NS.saveTopology();
  const badInputs = [
    { devices: [null] },
    { devices: [{ type: 'pc', ifaces: {} }] },
    { ...saved, version: 2 },
    { ...saved, links: {} },
    { ...saved, links: [...saved.links, saved.links[0]] },
    { ...saved, links: [{ ...saved.links[0], a: { dev: 'missing', if: 'eth0' } }] },
    { ...saved, links: [{ ...saved.links[0], loss: 101 }] },
    { ...saved, devices: [saved.devices[0], saved.devices[0]] },
    { devices: [{ type: 'pc', ifaces: [{ name: 'eth0', ip: '999.1.1.1' }] }] },
  ];
  let ticked = false;
  NS.Engine.schedule(10, () => { ticked = true; });
  for (const [i, data] of badInputs.entries()) {
    const ok = NS.loadTopology(data);
    assert(!ok && NS.world.devices.get(PC1.id) === PC1 && NS.world.links.size === saved.links.length,
      `错误导入 ${i + 1} 保留设备对象和链路`);
  }
  NS.Engine.advanceUntilIdle();
  assert(ticked, '错误导入保留待执行仿真事件');
  const legacy = JSON.parse(JSON.stringify(saved));
  delete legacy.version;
  legacy.devices.forEach(d => { if (d.type !== 'router') delete d.staticRoutes; });
  legacy.devices[0].x = 0;
  assert(NS.loadTopology(legacy), '兼容旧导出文件中缺省的版本号和主机路由表');
  assert(NS.world.devices.get(legacy.devices[0].id).x === 0, '导入保留零坐标');
  assert(NS.loadTopology({ version: 1, devices: [], links: [] }) && NS.world.devices.size === 0, '合法空拓扑可以导入');
}

section('T14 TCP 握手 ACK 丢失恢复');
{
  const { PC1, Server1 } = loadLab('lab-tcp');
  let dropped = 0, opened = 0;
  const received = [];
  droppingFrames((dev, frame) => {
    const seg = frame.payload.payload;
    if (dev === PC1 && seg?.proto === 'TCP' && seg.flags.ACK && !seg.flags.SYN && !seg.dataLen && !dropped) {
      dropped++; return true;
    }
    return false;
  }, () => {
    const conn = NS.Proto.tcp.open(PC1, '192.168.1.20', 23, {
      onOpen() { opened++; }, onData(c, data) { received.push(data); },
    });
    NS.Engine.advanceUntilIdle(30000);
    assert(dropped === 1 && conn.state === 'ESTABLISHED' && NS.Proto.tcp.connsOf(Server1)[0]?.state === 'ESTABLISHED', '只丢第三次 ACK 后双方均建立连接');
    assert(opened === 1 && received.length === 1, '重复 SYN+ACK 不重复触发打开回调或欢迎消息');
  });
}

section('T15 TCP 连续数据丢包恢复与重复包去重');
{
  const { PC1, Server1 } = loadLab('lab-tcp');
  const received = [];
  const conn = NS.Proto.tcp.open(PC1, '192.168.1.20', 23, { onData(c, data) { received.push(data); } });
  NS.Engine.advanceUntilIdle(30000);
  received.length = 0;
  let dropped = 0;
  droppingFrames((dev, frame) => {
    if (dev === PC1 && frame.payload.payload?.data === 'first\r\n' && !dropped) { dropped++; return true; }
    return false;
  }, () => {
    conn.send('first\r\n'); conn.send('second\r\n');
    NS.Engine.advanceUntilIdle(30000);
    assert(dropped === 1 && received.join('') === '[Server1] echo: first\r\n[Server1] echo: second\r\n', '连续发送时先丢的数据会重传，按顺序且只交付一次');
    assert(conn._unacked.length === 0, '累计确认清理所有未确认数据');
  });
  const serverConn = NS.Proto.tcp.connsOf(Server1)[0];
  const delivered = [];
  serverConn.app.onData = (c, data) => delivered.push(data);
  dropped = 0;
  droppingFrames((dev, frame) => {
    const seg = frame.payload.payload;
    if (dev === Server1 && seg?.flags.ACK && !seg.dataLen && !dropped) { dropped++; return true; }
    return false;
  }, () => {
    conn.send('once');
    NS.Engine.advanceUntilIdle(30000);
    assert(dropped === 1 && delivered.join(',') === 'once' && conn._unacked.length === 0, '丢失数据 ACK 后重复数据不会再次交给应用');
  });
}

section('T16 HTTP 丢响应后重传并完成挥手');
{
  const { PC1, Server1 } = loadLab('lab-tcp');
  const output = [];
  let dropped = 0, finished = false;
  droppingFrames((dev, frame) => {
    if (dev === Server1 && frame.payload.payload?.data?.startsWith('HTTP/1.1') && !dropped) { dropped++; return true; }
    return false;
  }, () => {
    NS.Commands.execute('http 192.168.1.20', { dev: PC1, print: text => output.push(text), endJob() { finished = true; } });
    NS.Engine.advanceUntilIdle(30000);
    assert(dropped === 1 && output.filter(s => s.includes('HTTP/1.1 200 OK')).length === 1, 'HTTP 响应丢失后仅交付一次完整响应');
    assert(finished && PC1.tcpRows().length === 0 && NS.Proto.tcp.connsOf(Server1).length === 0, '响应恢复后双方正常关闭连接');
  });
}

section('T17 TCP 最后 ACK 丢失、同时关闭与重传耗尽');
{
  const { PC1, Server1 } = loadLab('lab-tcp');
  const conn = NS.Proto.tcp.open(PC1, '192.168.1.20', 23, {});
  NS.Engine.advanceUntilIdle(30000);
  let dropped = 0;
  droppingFrames((dev, frame) => {
    const seg = frame.payload.payload;
    if (dev === PC1 && conn.state === 'FIN_WAIT_2' && seg?.flags.ACK && !seg.flags.FIN && !dropped) { dropped++; return true; }
    return false;
  }, () => {
    conn.close();
    NS.Engine.advanceUntilIdle(30000);
    assert(dropped === 1 && conn.state === 'CLOSED' && NS.Proto.tcp.connsOf(Server1).length === 0, '最终 ACK 丢失后回复重复 FIN，双方关闭');
  });
  const simultaneous = NS.Proto.tcp.open(PC1, '192.168.1.20', 23, {});
  NS.Engine.advanceUntilIdle(30000);
  const peer = NS.Proto.tcp.connsOf(Server1)[0];
  simultaneous.close(); peer.close();
  NS.Engine.advanceUntilIdle(30000);
  assert(simultaneous.state === 'CLOSED' && peer.state === 'CLOSED', '同时发送 FIN 能完成关闭');
  const errors = [];
  const failing = NS.Proto.tcp.open(PC1, '192.168.1.20', 23, { onErr(error) { errors.push(error); } });
  NS.Engine.advanceUntilIdle(30000);
  droppingFrames((dev, frame) => dev === PC1 && !!frame.payload.payload?.dataLen, () => {
    failing.send('lost forever');
    NS.Engine.advanceUntilIdle(30000);
    assert(failing.state === 'CLOSED' && errors.join(',') === 'timeout' && failing._unacked.length === 0, '数据重传耗尽时关闭连接并报告超时');
  });
}

section('T18 配置变化通知与 IP 修改清理缓存');
{
  const { PC1, Server1 } = loadLab('lab-tcp');
  pingResult(PC1, '192.168.1.20');
  let touched = 0;
  const off = NS.Bus.on('topology:touched', () => touched++);
  PC1.setIfConfig('eth0', { ip: '192.168.1.99' });
  assert(!PC1.arpCaches.get('eth0')?.size, '修改 IP 后清理旧 ARP 缓存');
  PC1.addRoute('10.0.0.0', '255.0.0.0', '192.168.1.1');
  PC1.removeRoute(0);
  PC1.power(false);
  Server1.services.http = false; Server1.applyServices();
  off();
  assert(touched === 5, 'IP、路由增删、电源、服务变化均触发保存通知');
}

section('T19 同时刻事件的发送顺序');
{
  NS.world.clear();
  const order = [];
  for (let i = 0; i < 5; i++) NS.Engine.schedule(5, () => order.push(i));
  NS.Engine.advanceUntilIdle();
  assert(order.join(',') === '0,1,2,3,4', '同一时刻的报文事件按入队顺序执行');
}

section('T20 高延迟链路和本地 TCP');
{
  const { PC1 } = loadLab('lab-tcp');
  NS.world.links.forEach(link => { link.delay = 500; });
  const output = [];
  NS.Commands.execute('http 192.168.1.20', { dev: PC1, print: text => output.push(text), endJob() {} });
  NS.Engine.advanceUntilIdle(60000);
  assert(output.filter(text => text.includes('HTTP/1.1 200 OK')).length === 1, '最大可配置链路延迟下 HTTP 正常返回且不重复交付');
  assert(PC1.tcpRows().length === 0, '高延迟 HTTP 完成挥手关闭');
  NS.world.clear();
  const server = NS.createDevice('server', 0, 0);
  let linkFrames = 0;
  const off = NS.Bus.on('frame', () => linkFrames++);
  output.length = 0;
  NS.Commands.execute('http 127.0.0.1', { dev: server, print: text => output.push(text), endJob() {} });
  NS.Engine.advanceUntilIdle(30000);
  off();
  assert(output.some(text => text.includes('HTTP/1.1 200 OK')) && linkFrames === 0, '本机 HTTP 通过回环完成握手和数据传输');
  assert(NS.Proto.tcp.connsOf(server).length === 0, '回环 HTTP 双方连接均完成关闭');
}

assert(runtimeErrors.length === 0, '协议事件和命令执行无被捕获的运行时异常');

/* ─────────── 输出 ─────────── */
console.log(results.join('\n'));
console.log(`\n══════════ 通过 ${pass} · 失败 ${fail} ══════════`);
process.exit(fail ? 1 : 0);
