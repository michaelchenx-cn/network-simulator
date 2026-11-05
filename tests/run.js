#!/usr/bin/env node
/* ═══════════ tests/run.js — 引擎自动化测试（无 DOM） ═══════════
 * 用法: node tests/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 以全局作用域加载脚本（与浏览器 <script> 等价） */
['i18n.js', 'engine.js', 'protocols.js', 'devices.js'].forEach(f => {
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

/* ─────────── 输出 ─────────── */
console.log(results.join('\n'));
console.log(`\n══════════ 通过 ${pass} · 失败 ${fail} ══════════`);
process.exit(fail ? 1 : 0);
