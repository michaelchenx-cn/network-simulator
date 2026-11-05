/* ═══════════════ commands.js — 终端命令（仿 Windows / Cisco 输出） ═══════════════
 * 每条命令: run(ctx, argv) → 可选返回 {abort(), wantsInput, onLine}（异步作业）
 * ctx: { dev, print(text, cls), clear(), endJob(), lang() }
 */
(function (root) {
  const NS = root.NS = root.NS || {};

  const L = (zh, en) => (NS.I18N.lang === 'zh' ? zh : en);
  const E = NS.Engine;
  const P = () => NS.Proto;
  const IP = NS.IP;

  let echoSeq = 0;
  const nextEchoId = () => (++echoSeq + 0x1000);
  const fmtMs = (ms) => (ms < 1 ? '<1ms' : `${Math.max(1, Math.round(ms))}ms`);

  /* ───── ipconfig ───── */
  function ipconfig(ctx, argv) {
    const all = argv.some(a => /^[-/]all$/i.test(a));
    const zh = NS.I18N.lang === 'zh';
    const out = [];
    out.push(zh ? '\nWindows IP 配置\n' : '\nWindows IP Configuration\n');
    ctx.dev.interfaces.forEach(ifce => {
      out.push('');
      out.push(zh ? `以太网适配器 ${ifce.name}:` : `Ethernet adapter ${ifce.name}:`);
      out.push('');
      const dns = zh ? '   连接特定的 DNS 后缀  . . . . . . . . : ' : '   Connection-specific DNS Suffix  . : ';
      out.push(dns);
      if (all) {
        const phys = zh ? '   物理地址. . . . . . . . . . . . . : ' : '   Physical Address. . . . . . . . . : ';
        out.push(phys + NS.macWin(ifce.mac));
      }
      if (ifce.ip) {
        out.push((zh ? '   IPv4 地址 . . . . . . . . . . . . . : ' : '   IPv4 Address. . . . . . . . . . . : ') + ifce.ip);
        out.push((zh ? '   子网掩码  . . . . . . . . . . . . . : ' : '   Subnet Mask . . . . . . . . . . . : ') + ifce.mask);
        if (ifce.gw) out.push((zh ? '   默认网关. . . . . . . . . . . . . : ' : '   Default Gateway . . . . . . . . . : ') + ifce.gw);
      } else {
        /* 未配置 → APIPA 自动配置地址（教学点：未配 IP 时 Windows 会自配 169.254.x.x） */
        const n = ifce.mac.split(':').slice(3).join(''), h = parseInt(n, 16) || 1;
        const apipa = `169.254.${(h >> 8) & 255}.${h & 255}`;
        out.push((zh ? '   自动配置 IPv4 地址 . . . . . . . . . : ' : '   Autoconfiguration IPv4 Address. . : ') + apipa);
        out.push((zh ? '   子网掩码  . . . . . . . . . . . . . : ' : '   Subnet Mask . . . . . . . . . . . : ') + '255.255.0.0');
      }
      if (all) {
        out.push(zh ? '   DHCP 已启用 . . . . . . . . . . . : 否' : '   DHCP Enabled. . . . . . . . . . : No');
        out.push(zh ? '   自动配置已启用 . . . . . . . . . : 是' : '   Autoconfiguration Enabled . . . . : Yes');
      }
    });
    ctx.print(out.join('\n') + '\n');
    return null;
  }

  /* ───── ping ───── */
  function pingCmd(ctx, argv) {
    const flags = {}, target = [];
    const isFlag = (a, f) => new RegExp('^[-/]' + f + '$', 'i').test(a);   /* 兼容 /n 与 -n */
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (isFlag(a, 'n')) flags.n = +argv[++i];
      else if (isFlag(a, 'l')) flags.l = +argv[++i];
      else if (isFlag(a, 'i')) flags.i = +argv[++i];
      else if (isFlag(a, 't')) flags.t = true;
      else if (isFlag(a, '4') || isFlag(a, '6')) { /* 忽略 */ }
      else target.push(a);
    }
    const dst = target[0];
    if (!dst || !IP.valid(dst)) {
      ctx.print(L(`Ping 请求找不到主机 ${dst || ''}。请检查该名称，然后重试。`,
                  `Ping request could not find host ${dst || ''}. Please check the name and try again.`), 't-dim');
      return null;
    }
    const n = flags.t ? Infinity : (flags.n && flags.n > 0 ? Math.min(flags.n, 50) : 4);
    const size = flags.l && flags.l > 0 ? Math.min(flags.l, 1500) : 32;
    const ttl = flags.i && flags.i > 0 ? Math.min(flags.i, 255) : 128;

    ctx.print(L(`\n正在 ping ${dst} 具有 ${size} 字节的数据:`, `\nPinging ${dst} with ${size} bytes of data:`));
    const st = { sent: 0, recv: 0, times: [], done: false, aborted: false };

    const stats = () => {
      const zh = NS.I18N.lang === 'zh';
      const lost = st.sent - st.recv;
      const out = ['',
        zh ? `${dst} 的 Ping 统计信息:` : `Ping statistics for ${dst}:`,
        zh ? `    数据包: 已发送 = ${st.sent}，已接收 = ${st.recv}，丢失 = ${lost} (${Math.round(lost / st.sent * 100)}% 丢失)，`
           : `    Packets: Sent = ${st.sent}, Received = ${st.recv}, Lost = ${lost} (${Math.round(lost / st.sent * 100)}% loss),`];
      if (st.times.length) {
        const mn = Math.min(...st.times), mx = Math.max(...st.times), av = st.times.reduce((a, b) => a + b, 0) / st.times.length;
        out.push(zh ? '往返行程的估计时间(以毫秒为单位):' : 'Approximate round trip times in milli-seconds:');
        out.push(zh ? `    最短 = ${fmtMs(mn)}，最长 = ${fmtMs(mx)}，平均 = ${fmtMs(av)}`
                    : `    Minimum = ${fmtMs(mn)}, Maximum = ${fmtMs(mx)}, Average = ${fmtMs(av)}`);
      }
      ctx.print(out.join('\n') + '\n');
    };

    const oneResult = (res, k) => {
      const zh = NS.I18N.lang === 'zh';
      if (res.kind === 'reply') {
        st.recv++; st.times.push(res.ms);
        ctx.print(zh ? `来自 ${res.from} 的回复: 字节=${size} 时间=${fmtMs(res.ms)} TTL=${res.ttl}`
                     : `Reply from ${res.from}: bytes=${size} time=${fmtMs(res.ms)} TTL=${res.ttl}`);
      } else if (res.kind === 'timeout') {
        ctx.print(zh ? '请求超时。' : 'Request timed out.', 't-err');
      } else if (res.kind === 'noroute') {
        ctx.print(zh ? 'PING: 传输失败。常见故障。' : 'PING: transmit failed. General failure.', 't-err');
      } else if (res.kind === 'unreachable') {
        const w = res.code === 1 ? (zh ? '无法访问目标主机。' : 'Destination host unreachable.')
                                 : (zh ? '无法访问目标网络。' : 'Destination net unreachable.');
        ctx.print(zh ? `来自 ${res.from} 的回复: ${w}` : `Reply from ${res.from}: ${w}`, 't-err');
      } else if (res.kind === 'tlexceeded') {
        ctx.print(zh ? `来自 ${res.from} 的回复: TTL 传输中过期。` : `Reply from ${res.from}: TTL expired in transit.`, 't-err');
      }
    };

    let k = 0;
    const next = () => {
      if (st.done) return;
      st.sent++; k++;
      P().icmpEcho(ctx.dev, dst, { echoId: nextEchoId(), seq: k, ttl, size, timeout: P().ICMP_TIMEOUT }, (res) => {
        if (st.done) return;
        oneResult(res, k);
        if (!flags.t && k >= n) { st.done = true; stats(); ctx.endJob(); return; }
        E.schedule(P().PING_INTERVAL, next, 'ping-next');
      });
    };
    if (!E.running) ctx.print(L('（仿真已暂停：按 ▶ 继续后报文才会收发）', '(Simulation paused: press \u25B6 to resume packet flow)'), 't-dim');
    next();

    return {
      abort() {
        if (st.done) return;
        st.done = true; stats(); ctx.endJob();
      },
    };
  }

  /* ───── tracert ───── */
  function tracertCmd(ctx, argv) {
    const dst = argv.find(a => !a.startsWith('-') && !a.startsWith('/'));
    if (!dst || !IP.valid(dst)) {
      ctx.print(L(`用法: tracert <目标IP>`, `Usage: tracert <target-ip>`), 't-dim');
      return null;
    }
    const zh = NS.I18N.lang === 'zh';
    const maxHops = 30;
    ctx.print('');
    ctx.print(zh ? `通过最多 ${maxHops} 个跃点跟踪到 ${dst} 的路由:` : `Tracing route to ${dst} over a maximum of ${maxHops} hops:`);

    const st = { done: false };
    let hop = 1;

    const probe = (h, trial, times, ipOfHop, doneHop) => {
      if (st.done) return;
      P().icmpEcho(ctx.dev, dst, { echoId: nextEchoId(), seq: h * 10 + trial, ttl: h, timeout: 1500 }, (res) => {
        if (st.done) return;
        if (res.kind === 'reply' || res.kind === 'tlexceeded') {
          times.push(res.ms || 1);
          ipOfHop = res.from;
          nextTrial();
        } else if (res.kind === 'timeout') {
          times.push(null); nextTrial();
        } else if (res.kind === 'unreachable') {
          const w = res.code === 1 ? (zh ? '报告: 无法访问目标主机。' : 'Reports: Destination host unreachable.')
                                   : (zh ? '报告: 无法访问目标网络。' : 'Reports: Destination net unreachable.');
          printHop(h, [1, 1, 1], `${res.from} ${w}`, true);
          finish(true);
          return;
        } else if (res.kind === 'noroute') {
          ctx.print(zh ? 'PING: 传输失败。常见故障。' : 'PING: transmit failed. General failure.', 't-err');
          finish(true);
          return;
        }
        function nextTrial() {
          if (trial < 3) probe(h, trial + 1, times, ipOfHop, doneHop);
          else doneHop(times, ipOfHop);
        }
      });
    };

    const fmtTime = (t) => (t == null ? '  *       ' : String(Math.max(1, Math.round(t))).padStart(4) + ' ms  ');
    const printHop = (h, times, ip, done) => {
      const line = [String(h).padStart(3), fmtTime(times[0]), fmtTime(times[1]), fmtTime(times[2]), ip].join(' ');
      ctx.print(line, done ? undefined : undefined);
    };
    const finish = (early) => {
      if (st.done) return;
      st.done = true;
      ctx.print('');
      ctx.print(zh ? '跟踪完成。' : 'Trace complete.');
      ctx.endJob();
    };

    const runHop = (h) => {
      if (st.done) return;
      if (h > maxHops) { finish(); return; }
      probe(h, 1, [], null, (times, ip) => {
        const reached = ip === dst;
        if (ip) printHop(h, times, ip);
        else {
          ctx.print([String(h).padStart(3), '  *       ', '  *       ', '  *       ', zh ? '请求超时。' : 'Request timed out.'].join(' '), 't-err');
        }
        if (reached) { finish(); return; }
        E.schedule(60, () => runHop(h + 1), 'tracert-hop');
      });
    };
    if (!E.running) ctx.print(L('（仿真已暂停：按 ▶ 继续后报文才会收发）', '(Simulation paused: press \u25B6 to resume packet flow)'), 't-dim');
    runHop(1);
    return { abort() { if (!st.done) { st.done = true; ctx.endJob(); } } };
  }

  /* ───── arp ───── */
  function arpCmd(ctx, argv) {
    const zh = NS.I18N.lang === 'zh';
    if (argv.some(a => /^-d/i.test(a))) {
      ctx.dev.arpCaches && ctx.dev.arpCaches.clear();
      ctx.print(zh ? 'ARP 缓存已清空。' : 'ARP cache flushed.');
      NS.Bus.emit('device:changed', ctx.dev.id);
      return null;
    }
    const rows = [];
    ctx.dev.interfaces.forEach(ifce => {
      const cache = ctx.dev.arpCaches && ctx.dev.arpCaches.get(ifce.name);
      if (!cache || !cache.size || !ifce.ip) return;
      rows.push('');
      rows.push(zh ? `接口: ${ifce.ip} --- 0x3` : `Interface: ${ifce.ip} --- 0x3`);
      rows.push(zh ? '  Internet 地址         物理地址              类型'
                   : '  Internet Address      Physical Address      Type');
      [...cache.entries()].sort().forEach(([ip, e]) => {
        rows.push(`  ${ip.padEnd(20)}${NS.macWin(e.mac).padEnd(22)}${zh ? '动态' : 'dynamic'}`);
      });
    });
    if (!rows.length) ctx.print(zh ? '未找到 ARP 项。' : 'No ARP Entries Found.');
    else ctx.print(rows.join('\n') + '\n');
    return null;
  }

  /* ───── netstat ───── */
  function netstatCmd(ctx, argv) {
    const zh = NS.I18N.lang === 'zh';
    const showAll = argv.some(a => /^-a/i.test(a));
    const rows = ctx.dev.tcpRows().filter(r => showAll || r.state !== 'LISTENING');
    const out = ['', zh ? '活动连接' : 'Active Connections', ''];
    out.push(zh ? '  协议  本地地址              外部地址             状态'
                : '  Proto  Local Address          Foreign Address         State');
    if (!rows.length) out.push('');
    rows.forEach(r => {
      out.push(`  TCP    ${r.local.padEnd(20)}${r.foreign.padEnd(21)}${r.state}`);
    });
    ctx.print(out.join('\n') + '\n');
    return null;
  }

  /* ───── route print / add / delete ───── */
  function routeCmd(ctx, argv) {
    const zh = NS.I18N.lang === 'zh';
    const dev = ctx.dev;
    const sub = (argv[0] || 'print').toLowerCase();
    if (sub === 'add' || sub === 'delete') {
      if (dev.type !== 'router' && dev.type !== 'pc' && dev.type !== 'server') return null;
      if (sub === 'add') {
        const dest = argv[1], mask = (argv[2] || '').toLowerCase() === 'mask' ? argv[3] : '255.255.255.255';
        const nhIdx = argv.indexOf('mask') === 2 ? 4 : 2;
        const nh = argv[nhIdx] && !/^mask$/i.test(argv[nhIdx]) ? argv[nhIdx] : argv[argv.length - 1];
        if (dev.addRoute(dest, mask, nh)) ctx.print(zh ? ' 操作完成!' : ' Manipulated route successfully!');
        else ctx.print(zh ? '路由添加失败: 参数不正确。' : 'The route addition failed: The parameter is incorrect.', 't-err');
      } else {
        const dest = argv[1];
        const i = (dev.staticRoutes || []).findIndex(r => r.dest === dest);
        if (i >= 0) { dev.removeRoute(i); ctx.print(zh ? ' 操作完成!' : ' Manipulated route successfully!'); }
        else ctx.print(zh ? '找不到元素。' : 'Element not found.', 't-err');
      }
      return null;
    }
    /* print */
    const rows = [];
    dev.interfaces.forEach(ifce => {
      if (ifce.ip && ifce.mask) rows.push({ dest: IP.network(ifce.ip, ifce.mask), mask: ifce.mask, gw: null, ifce: ifce.ip, metric: 281 });
    });
    (dev.staticRoutes || []).forEach(r => rows.push({ dest: r.dest, mask: r.mask, gw: r.nh, ifce: '', metric: 1 }));
    const gwIf = dev.interfaces.find(i => i.gw);
    if (gwIf) rows.push({ dest: '0.0.0.0', mask: '0.0.0.0', gw: gwIf.gw, ifce: gwIf.ip, metric: 25 });

    const out = [];
    out.push('===========================================================================');
    out.push(zh ? 'IPv4 路由表' : 'IPv4 Route Table');
    out.push('===========================================================================');
    out.push(zh ? '活动路由:' : 'Active Routes:');
    out.push(zh ? '网络目标            网络掩码            网关          接口          跃点数'
                : 'Network Destination        Netmask          Gateway       Interface  Metric');
    if (!rows.length) out.push(zh ? '  （无路由）' : '  (no routes)');
    rows.sort((a, b) => IP.parse(a.mask) - IP.parse(b.mask) || IP.parse(a.dest) - IP.parse(b.dest));
    rows.forEach(r => {
      const gw = r.gw || (zh ? '在链上' : 'on-link');
      if (zh) out.push(`${r.dest.padEnd(20)}${r.mask.padEnd(20)}${gw.padEnd(14)}${r.ifce.padEnd(16)}${String(r.metric).padStart(5)}`);
      else out.push(`${r.dest.padEnd(26)}${r.mask.padEnd(18)}${gw.padEnd(16)}${r.ifce.padEnd(18)}${String(r.metric).padStart(5)}`);
    });
    out.push('===========================================================================');
    ctx.print(out.join('\n') + '\n');
    return null;
  }

  /* ───── show …（路由器/交换机风格） ───── */
  function showCmd(ctx, argv) {
    const zh = NS.I18N.lang === 'zh';
    const dev = ctx.dev;
    const what = argv.join(' ').toLowerCase();
    if (dev.type === 'router' && /ip route/.test(what)) {
      const out = ['Codes: C - connected, S - static', ''];
      dev.interfaces.forEach(ifce => {
        if (ifce.ip && ifce.mask) out.push(`C  ${IP.network(ifce.ip, ifce.mask)}/${IP.maskLen(ifce.mask)} is directly connected, ${ifce.name}`);
      });
      (dev.staticRoutes || []).forEach(r => out.push(`S  ${r.dest}/${IP.maskLen(r.mask)} [1/0] via ${r.nh}`));
      if (out.length === 2) out.push(zh ? '（无路由）' : '(no routes)');
      ctx.print(out.join('\n') + '\n');
    } else if (dev.type === 'router' && /arp/.test(what)) {
      ctx.dev = dev; arpCmd(ctx, []);
    } else if (dev.type === 'switch' && /mac/.test(what)) {
      const out = ['Mac Address Table', '-------------------------------------------'];
      const rows = [...dev.macTable.entries()];
      if (!rows.length) out.push(zh ? ' No MAC entries' : ' No MAC entries');
      rows.forEach(([mac, e]) => {
        const ciscoMac = mac.replace(/:/g, '').replace(/(.{4})(.{4})(.{4})/, '$1.$2.$3').toLowerCase();
        out.push(`   1    ${ciscoMac.padEnd(14)}  DYNAMIC     ${e.port}`);
      });
      ctx.print(out.join('\n') + '\n');
    } else if (/interface/.test(what)) {
      const out = [];
      dev.interfaces.forEach(ifce => {
        out.push(`${ifce.name}  ${ifce.ip ? `${ifce.ip} ${ifce.mask}` : 'unassigned'}  ${ifce.linkId ? 'up' : 'down'}  ${ifce.mac}`);
      });
      ctx.print(out.join('\n') + '\n');
    } else {
      ctx.print(zh ? `show: 未知子命令。试试 show ip route / show arp / show mac / show interfaces`
                   : `show: unknown subcommand. Try show ip route / show arp / show mac / show interfaces`, 't-dim');
    }
    return null;
  }

  /* ───── telnet ───── */
  function telnetCmd(ctx, argv) {
    const zh = NS.I18N.lang === 'zh';
    const dst = argv[0], port = +argv[1] || 23;
    if (!dst || !IP.valid(dst)) { ctx.print(zh ? '用法: telnet <IP> [端口]' : 'Usage: telnet <ip> [port]'); return null; }
    if (!E.running) ctx.print(L('（仿真已暂停：按 ▶ 继续后报文才会收发）', '(Simulation paused: press \u25B6 to resume packet flow)'), 't-dim');

    let finished = false;
    const job = {
      wantsInput: true,
      onLine(line) {
        const t = line.trim();
        if (t.toLowerCase() === 'quit') {
          conn.send('quit');
          ctx.print(zh ? '（正在断开连接…）' : '(closing connection...)', 't-dim');
        } else if (t) conn.send(t + '\r\n');
      },
      abort() { finish(); conn && P().tcp.abort(conn, true); },
    };
    const finish = () => { if (!finished) { finished = true; ctx.endJob(); } };

    const conn = P().tcp.open(ctx.dev, dst, port, {
      onOpen() { ctx.print(zh ? `已连接到 ${dst}:${port}（输入内容将发送给服务器，输入 quit 断开）` : `Connected to ${dst}:${port} (type to send; 'quit' to close)`); },
      onData(c, d) {
        const text = String(d).replace(/\r/g, '');
        ctx.print(text);
        /* 收到 Goodbye 后由客户端主动挥手（可观察四次挥手 + TIME_WAIT） */
        if (/Goodbye/.test(text)) NS.Engine.schedule(150, () => c.close(), 'telnet-client-close');
      },
      onPeerFin(c) { c.close(); },
      onClose() { ctx.print(zh ? '连接已关闭。' : 'Connection closed.', 't-dim'); finish(); },
      onErr(m) {
        if (m === 'refused') ctx.print(zh ? `连接失败: 目标端口 ${port} 未开放，连接被拒绝。` : `Connect failed: connection refused (port ${port} not open).`, 't-err');
        else ctx.print(zh ? '连接尝试失败（超时）。' : 'Connection attempt failed (timeout).', 't-err');
        finish();
      },
    });
    return job;
  }

  /* ───── http（浏览器访问网页的抽象演示） ───── */
  function httpCmd(ctx, argv) {
    const zh = NS.I18N.lang === 'zh';
    const dst = argv[0];
    if (!dst || !IP.valid(dst)) { ctx.print(zh ? '用法: http <IP>' : 'Usage: http <ip>'); return null; }
    if (!E.running) ctx.print(L('（仿真已暂停：按 ▶ 继续后报文才会收发）', '(Simulation paused: press \u25B6 to resume packet flow)'), 't-dim');
    let finished = false;
    const finish = () => { if (!finished) { finished = true; ctx.endJob(); } };
    P().tcp.open(ctx.dev, dst, 80, {
      onOpen(conn) {
        ctx.print(zh ? `已连接到 ${dst}:80，发送 HTTP GET 请求…` : `Connected to ${dst}:80, sending HTTP GET...`, 't-info');
        conn.send(`GET / HTTP/1.1\r\nHost: ${dst}\r\n\r\n`);
      },
      onData(c, d) { ctx.print(String(d).replace(/\r/g, '\n'), 't-ok'); },
      onPeerFin(c) { c.close(); },
      onClose() { ctx.print(zh ? '\n连接已关闭。' : '\nConnection closed.', 't-dim'); finish(); },
      onErr(m) {
        if (m === 'refused') ctx.print(zh ? '连接失败: 80 端口未开放（服务器 HTTP 服务未启用？）' : 'Connect failed: port 80 not open (HTTP service disabled?)', 't-err');
        else ctx.print(zh ? '连接尝试失败（超时）。' : 'Connection attempt failed (timeout).', 't-err');
        finish();
      },
    });
    return { abort() { finish(); } };
  }

  /* ───── 帮助 ───── */
  function helpCmd(ctx) {
    const zh = NS.I18N.lang === 'zh';
    const rows = zh ? [
      ['ipconfig [/all]', '查看本机 IP / 掩码 / 网关 / MAC'],
      ['ping [-n N] [-t] [-i TTL] <IP>', '测试连通性，观察 ICMP 与 ARP 过程'],
      ['tracert <IP>', '跟踪逐跳路径（TTL 递增探测）'],
      ['arp -a | arp -d', '查看 / 清空 ARP 缓存'],
      ['netstat [-an]', '查看 TCP 连接与状态（观察握手/挥手）'],
      ['route print | add | delete', '查看 / 添加 / 删除路由'],
      ['telnet <IP> [端口]', '建立 TCP 连接（观察三次握手）'],
      ['http <IP>', '模拟浏览器访问（握手→GET→响应→挥手）'],
      ['show ip route / show arp / show mac', '路由器 / 交换机视图'],
      ['cls', '清屏'],
      ['exit', '关闭终端'],
    ] : [
      ['ipconfig [/all]', 'Show IP / mask / gateway / MAC'],
      ['ping [-n N] [-t] [-i TTL] <ip>', 'Test reachability (watch ICMP & ARP)'],
      ['tracert <ip>', 'Trace hops with increasing TTL'],
      ['arp -a | arp -d', 'Show / flush ARP cache'],
      ['netstat [-an]', 'Show TCP connections & states'],
      ['route print | add | delete', 'Show / add / delete routes'],
      ['telnet <ip> [port]', 'Open a TCP session (3-way handshake)'],
      ['http <ip>', 'Simulated browser fetch (handshake→GET→response→close)'],
      ['show ip route / show arp / show mac', 'Router / switch views'],
      ['cls', 'Clear screen'],
      ['exit', 'Close terminal'],
    ];
    ctx.print('\n' + rows.map(r => '  ' + r[0].padEnd(34) + r[1]).join('\n') + '\n');
    return null;
  }

  /* ───── 命令表 ───── */
  const COMMANDS = {
    help: helpCmd, '?': helpCmd,
    ipconfig, ping: pingCmd, tracert: tracertCmd, arp: arpCmd, netstat: netstatCmd,
    route: routeCmd, show: showCmd, telnet: telnetCmd, http: httpCmd,
    cls(ctx) { ctx.clear(); return null; },
    clear(ctx) { ctx.clear(); return null; },
    exit(ctx) { ctx.exit && ctx.exit(); return null; },
    hostname(ctx) { ctx.print(ctx.dev.name); return null; },
    getmac(ctx) {
      ctx.dev.interfaces.forEach(i => ctx.print(`${NS.macWin(i.mac)}  ${i.name}`));
      return null;
    },
  };

  NS.Commands = {
    execute(line, ctx) {
      const parts = line.trim().split(/\s+/);
      const name = (parts[0] || '').toLowerCase();
      const argv = parts.slice(1);
      const cmd = COMMANDS[name];
      if (!cmd) {
        ctx.print(L(`'${name}' 不是内部或外部命令，也不是可运行的程序或批处理文件。`,
                    `'${name}' is not recognized as an internal or external command.`), 't-err');
        return null;
      }
      try {
        return cmd(ctx, argv) || null;
      } catch (e) {
        console.error(e);
        ctx.print(L('命令执行出错。', 'Command error.'), 't-err');
        return null;
      }
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
