/* ═══════════════ protocols.js — 协议栈（ARP / IPv4 / ICMP / TCP） ═══════════════
 * 与 devices.js 配合：devices 定义数据模型，本文件通过 attach*Stack(dev)
 * 为设备挂上协议行为（发送 / 接收 / 转发）。
 *
 * 报文模型（模拟真实封装层级）：
 *   frame  = { eth:{dst,src,type}, payload, len }
 *   arp    = { op:1|2, sha, spa, tha, tpa }
 *   ipPkt  = { ip:{src,dst,ttl,proto,id}, payload }
 *   icmp   = { type:8|0|11|3, code, echoId, seq, dataLen, origDst? }
 *   tcpSeg = { sport, dport, flags:{SYN,ACK,FIN,RST,PSH}, seq, ack, win, dataLen, data? }
 */
(function (root) {
  const NS = root.NS = root.NS || {};
  const Engine = NS.Engine, Bus = NS.Bus;

  /* ══════════ IP 工具 ══════════ */
  const IP = {
    parse(s) {                       // '192.168.1.1' -> 整数或 null
      if (typeof s !== 'string') return null;
      const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (!m) return null;
      const p = m.slice(1).map(Number);
      if (p.some(x => x > 255)) return null;
      return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
    },
    str(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); },
    valid(s) { return IP.parse(s) !== null; },
    validMask(s) {
      const n = IP.parse(s); if (n === null) return false;
      const inv = (~n) >>> 0;
      return (inv & (inv + 1)) === 0;         // 连续 1 掩码
    },
    maskLen(s) {
      const n = IP.parse(s); let c = 0;
      for (let i = 31; i >= 0 && (n >>> i) & 1; i--) c++;
      return c;
    },
    maskOf(len) { return len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0; },
    inSubnet(ip, netIp, mask) { return ((IP.parse(ip) ^ IP.parse(netIp)) & IP.parse(mask)) === 0; },
    network(ip, mask) { return IP.str((IP.parse(ip) & IP.parse(mask)) >>> 0); },
    BROADCAST: '255.255.255.255',
    isBroadcast(mac) { return mac === 'FF:FF:FF:FF:FF:FF'; },
  };
  NS.IP = IP;

  /* Windows 风格 MAC 显示：00-50-56-0A-00-01 */
  NS.macWin = (m) => (m || '').replace(/:/g, '-').toUpperCase();

  /* ══════════ 报文工厂 ══════════ */
  let ipId = 1, flightId = 1;
  const Frames = {
    arp(op, sha, spa, tha, tpa) {
      return { eth: { dst: op === 1 ? 'FF:FF:FF:FF:FF:FF' : tha, src: sha, type: 'ARP' },
               payload: { op, sha, spa, tha, tpa }, len: 14 + 28 };
    },
    ip(srcMac, dstMac, srcIp, dstIp, ttl, proto, payload) {
      const hdr = 14 + 20;
      const l4len = payload ? (payload.len || 0) : 0;
      return { eth: { dst: dstMac, src: srcMac, type: 'IPv4' },
               payload: { ip: { src: srcIp, dst: dstIp, ttl, proto, id: ipId++ }, payload },
               len: hdr + l4len };
    },
    icmp(type, code, echoId, seq, dataLen, origDst) {
      return { proto: 'ICMP', type, code, echoId, seq, dataLen, origDst, len: 8 + (dataLen || 0) };
    },
    tcp(sport, dport, flags, seq, ack, data) {
      const f = {};
      ['SYN', 'ACK', 'FIN', 'RST', 'PSH'].forEach(k => f[k] = !!flags[k]);
      return { proto: 'TCP', sport, dport, flags: f, seq, ack, win: 8192, dataLen: data ? data.length : 0, data, len: 20 + (data ? data.length : 0) };
    },
    lenOf(frame) { return frame.len; },
  };
  NS.Frames = Frames;

  /* ══════════ 链路传输 ══════════
   * NS.world = { devices: Map, links: Map } 由 devices.js 提供 */
  const Net = {
    linkBetween(ifA, ifB) { return ifA.linkId && ifA.linkId === ifB.linkId ? NS.world.links.get(ifA.linkId) : null; },

    /* 从 dev.outIf 发出一帧；返回 true 表示已上线 */
    tx(dev, outIf, frame) {
      if (!outIf || !outIf.linkId) { NS.log(`${dev.name}: ${outIf ? outIf.name : '?'} 没有链路，丢弃报文`, 'warn'); return false; }
      const link = NS.world.links.get(outIf.linkId);
      if (!link || !link.up) { NS.log(`${dev.name}: 链路断开，丢弃 ${frame.eth.type} 报文`, 'warn'); return false; }
      const other = link.a.dev === dev.id ? link.b : link.a;
      const peer = NS.world.devices.get(other.dev);
      if (!peer || !peer.on) { NS.log(`${dev.name}: 对端关机，丢弃报文`, 'warn'); return false; }

      if (link.loss > 0 && Math.random() * 100 < link.loss) {
        NS.log(`${dev.name} → ${peer.name}: 丢包率触发，${frame.eth.type} 报文丢失`, 'warn');
        return false;
      }

      const id = flightId++;
      const t0 = Engine.time, t1 = t0 + link.delay;
      Bus.emit('frame', { t: t0, linkId: link.id, linkName: link.name(), fromDev: dev.id, frame, len: frame.len });
      Bus.emit('flight', { id, linkId: link.id, frame, t0, t1, from: dev.id });
      Engine.schedule(link.delay, () => {
        Bus.emit('flight:end', id);
        if (peer.on) peer.receiveFrame(frame, peer.getInterface(other.ifName));
      }, `tx ${frame.eth.type} ${dev.name}→${peer.name}`);
      return true;
    },
  };
  NS.Net = Net;

  /* ══════════ 协议栈 ══════════ */
  const Proto = {
    ARP_TIMEOUT: 2000,      // ARP 解析失败等待(ms 仿真)
    ARP_AGE: 300000,        // ARP 缓存寿命 5min
    MAC_AGE: 300000,        // 交换机 MAC 表寿命
    ICMP_TIMEOUT: 4000,     // ping 等待，同 Windows
    PING_INTERVAL: 1000,
    TCP_RTO: 1000,          // 重传超时
    TCP_SYN_RETRY: 2,       // SYN 额外重传次数
    TCP_DATA_RETRY: 2,
    MSL: 3000,              // TIME_WAIT = 2*MSL = 6s 仿真时间

    /* ───── ARP 缓存 ───── */
    arpCacheOf(dev, ifName) {
      if (!dev.arpCaches) dev.arpCaches = new Map();
      if (!dev.arpCaches.has(ifName)) dev.arpCaches.set(ifName, new Map());
      return dev.arpCaches.get(ifName);
    },
    arpLookup(dev, ifName, ip) {
      const e = this.arpCacheOf(dev, ifName).get(ip);
      if (e && Engine.time - e.t > this.ARP_AGE) { this.arpCacheOf(dev, ifName).delete(ip); return null; }
      return e ? e.mac : null;
    },
    arpLearn(dev, ifName, ip, mac) {
      if (!ip || !mac || ip === '0.0.0.0' || mac === '00:00:00:00:00:00') return;
      this.arpCacheOf(dev, ifName).set(ip, { mac, t: Engine.time });
      Bus.emit('device:changed', dev.id);
    },

    /* 解析 nextHopIp 的 MAC；cb(err, mac)。失败(err='timeout')模拟对端不在线/断链 */
    arpResolve(dev, outIf, nextHopIp, cb) {
      const hit = this.arpLookup(dev, outIf.name, nextHopIp);
      if (hit) return cb(null, hit);
      if (!dev._arpPending) dev._arpPending = new Map();
      const key = outIf.name + '|' + nextHopIp;
      if (dev._arpPending.has(key)) { dev._arpPending.get(key).cbs.push(cb); return; }

      const pend = { cbs: [cb], timer: null };
      dev._arpPending.set(key, pend);
      pend.timer = Engine.schedule(this.ARP_TIMEOUT, () => {
        if (!dev._arpPending.has(key)) return;
        dev._arpPending.delete(key);
        NS.log(`${dev.name}: ARP 解析 ${nextHopIp} 超时`, 'warn');
        pend.cbs.forEach(fn => fn('timeout'));
        Bus.emit('device:changed', dev.id);
      }, `arp-timeout ${nextHopIp}`);

      NS.log(`${dev.name}: 广播 ARP 请求，查询 ${nextHopIp} 的 MAC`, 'info');
      Net.tx(dev, outIf, Frames.arp(1, outIf.mac, outIf.ip, '00:00:00:00:00:00', nextHopIp));
    },

    arpInbound(dev, ifce, arp) {
      if (arp.op === 1 && arp.tpa === ifce.ip) {
        // 请求本接口 IP → 单播应答
        Net.tx(dev, ifce, Frames.arp(2, ifce.mac, ifce.ip, arp.sha, arp.spa));
      } else if (arp.op === 2 && arp.tpa === ifce.ip) {
        this.arpLearn(dev, ifce.name, arp.spa, arp.sha);
        if (!dev._arpPending) return;
        const key = ifce.name + '|' + arp.spa;
        const pend = dev._arpPending.get(key);
        if (pend) {
          Engine.cancel(pend.timer);
          dev._arpPending.delete(key);
          NS.log(`${dev.name}: 收到 ARP 应答 ${arp.spa} is-at ${arp.sha}`, 'ok');
          pend.cbs.forEach(fn => fn(null, arp.sha));
        }
      }
    },

    /* ───── 路由决策 ───── */
    /* 主机路由：返回 {ifce, nextHop} | {err:'noroute'|'badgw'} */
    hostRoute(dev, dstIp) {
      for (const ifce of dev.interfaces) {
        if (!ifce.ip || !ifce.mask) continue;
        if (IP.inSubnet(dstIp, ifce.ip, ifce.mask)) return { ifce, nextHop: dstIp };
      }
      const gwIf = dev.interfaces.find(ifce => ifce.gw);
      if (gwIf) {
        if (gwIf.ip && gwIf.mask && IP.inSubnet(gwIf.gw, gwIf.ip, gwIf.mask)) return { ifce: gwIf, nextHop: gwIf.gw };
        return { err: 'badgw' };
      }
      return { err: 'noroute' };
    },

    /* 路由器路由：直连 + 静态最长前缀匹配 */
    routerRoute(dev, dstIp) {
      for (const ifce of dev.interfaces) {
        if (!ifce.ip || !ifce.mask) continue;
        if (IP.inSubnet(dstIp, ifce.ip, ifce.mask)) return { ifce, nextHop: dstIp };
      }
      let best = null;
      for (const r of (dev.staticRoutes || [])) {
        if (!IP.valid(r.dest) || !IP.validMask(r.mask) || !IP.valid(r.nh)) continue;
        if (!IP.inSubnet(dstIp, r.dest, r.mask)) continue;
        const len = IP.maskLen(r.mask);
        if (!best || len > best.len) best = { ...r, len };
      }
      if (best) {
        const nhIf = dev.interfaces.find(ifce => ifce.ip && ifce.mask && IP.inSubnet(best.nh, ifce.ip, ifce.mask));
        if (nhIf) return { ifce: nhIf, nextHop: best.nh };
      }
      return { err: 'noroute' };
    },

    /* ───── 发送 IP 包（主机与路由器共用入口） ─────
     * srcIf 可省略（自动选择）。opts.errCb 接收 'noroute'/'badgw'/'arptimeout'。 */
    sendIp(dev, dstIp, l4, opts = {}) {
      const r = dev.type === 'router' ? this.routerRoute(dev, dstIp) : this.hostRoute(dev, dstIp);
      if (r.err) {
        NS.log(`${dev.name}: 无到 ${dstIp} 的路由`, 'warn');
        if (opts.errCb) opts.errCb(r.err);
        return;
      }
      const srcIp = opts.srcIp || (r.ifce.ip || '0.0.0.0');
      this.arpResolve(dev, r.ifce, r.nextHop, (err, mac) => {
        if (err) { if (opts.errCb) opts.errCb('arptimeout'); return; }
        Net.tx(dev, r.ifce, Frames.ip(r.ifce.mac, mac, srcIp, dstIp, opts.ttl == null ? 128 : opts.ttl, l4.proto, l4));
      });
    },

    /* ───── ICMP 探测（ping / tracert / 实验验收共用） ─────
     * onDone(result):
     *   {kind:'reply', from, ms, ttl}  正常回复
     *   {kind:'timeout'}               超时 / ARP 失败
     *   {kind:'tlexceeded', from}      TTL 超时（tracert 中间跳）
     *   {kind:'unreachable', from, code}  目标不可达
     *   {kind:'noroute'}               本机无路由（传输失败） */
    icmpEcho(dev, dstIp, { echoId, seq = 1, ttl = 128, size = 32, timeout } = {}, onDone) {
      if (!dev.icmpCbs) dev.icmpCbs = new Map();
      let done = false;
      const finish = (res) => {
        if (done) return; done = true;
        Engine.cancel(timer);
        dev.icmpCbs.delete(echoId);
        onDone(res);
      };
      const sentAt = Engine.time;
      const entry = { finish, sentAt };
      dev.icmpCbs.set(echoId, entry);
      const timer = Engine.schedule(timeout || this.ICMP_TIMEOUT, () => finish({ kind: 'timeout' }), `icmp-timeout ${dstIp}`);

      this.sendIp(dev, dstIp, Frames.icmp(8, 0, echoId, seq, size), {
        ttl,
        errCb: (e) => finish(e === 'arptimeout' ? { kind: 'timeout', arp: true } : { kind: 'noroute' }),
      });
    },

    /* ICMP 入站处理（目标是自己） */
    icmpInbound(dev, ifce, ipPkt, icmp) {
      const ip = ipPkt.ip;
      if (icmp.type === 8) {                       // echo request → 回复
        this.sendIp(dev, ip.src, Frames.icmp(0, 0, icmp.echoId, icmp.seq, icmp.dataLen), { ttl: 128 });
      } else if (icmp.type === 0 || icmp.type === 11 || icmp.type === 3) {
        const entry = dev.icmpCbs && dev.icmpCbs.get(icmp.echoId);
        if (!entry) return;
        if (icmp.type === 0) entry.finish({ kind: 'reply', from: ip.src, ms: Engine.time - entry.sentAt, ttl: ip.ttl });
        else if (icmp.type === 11) entry.finish({ kind: 'tlexceeded', from: ip.src });
        else entry.finish({ kind: 'unreachable', from: ip.src, code: icmp.code });
      }
    },

    /* ───── TCP ───── */
    tcp: {
      /* conn: {id, dev, side:'active'|'passive', localIp, localPort, remoteIp, remotePort,
       *        state, seq, ack, app:{onOpen,onData,onClose,onErr}, _rt:{seg,timer,retries}, _timers:[]} */
      _cid: 1,

      listenersOf(dev) { if (!dev._listeners) dev._listeners = new Map(); return dev._listeners; },
      connsOf(dev) { if (!dev._tcpConns) dev._tcpConns = []; return dev._tcpConns; },
      historyOf(dev) { if (!dev._tcpHist) dev._tcpHist = { established: 0, finClosed: 0, refused: 0 }; return dev._tcpHist; },

      isOpen(c) { return c && c.state !== 'CLOSED'; },

      listen(dev, port, service) { this.listenersOf(dev).set(port, service); Bus.emit('device:changed', dev.id); },
      unlisten(dev, port) { this.listenersOf(dev).delete(port); Bus.emit('device:changed', dev.id); },

      /* 主动打开（客户端 connect） */
      open(dev, dstIp, dstPort, app) {
        const conns = this.connsOf(dev);
        const port = (dev._eph || 1024) + Math.floor(Math.random() * 200); dev._eph = (dev._eph || 1324);
        const srcIf = dev.interfaces.find(i => i.ip);
        const conn = {
          id: this._cid++, dev, side: 'active',
          localIp: srcIf ? srcIf.ip : '0.0.0.0', localPort: 1325 + (dev._ephSeq = (dev._ephSeq || 0) + 1),
          remoteIp: dstIp, remotePort: dstPort, state: 'SYN_SENT',
          seq: 1000 + Math.floor(Math.random() * 900), ack: 0, app: app || {},
        };
        conns.push(conn);
        conn.seq++;                                  // SYN 占一个序号
        this._send(dev, conn, Frames.tcp(conn.localPort, dstPort, { SYN: 1 }, conn.seq - 1, 0), Proto.TCP_SYN_RETRY);
        Bus.emit('device:changed', dev.id);
        return this._helpers(conn);
      },

      /* 给连接对象挂应用侧便捷方法 */
      _helpers(conn) {
        conn.send = (d) => { if (conn.state === 'ESTABLISHED') this.send(conn, d); };
        conn.close = () => this.close(conn);
        return conn;
      },

      /* 发送数据 */
      send(conn, data) {
        if (conn.state !== 'ESTABLISHED') return;
        this._send(conn.dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { PSH: 1, ACK: 1 }, conn.seq, conn.ack, data), Proto.TCP_DATA_RETRY);
        conn.seq += data.length;
      },

      /* 主动关闭（FIN） */
      close(conn) {
        if (conn.state === 'ESTABLISHED') {
          conn.state = 'FIN_WAIT_1';
          this._send(conn.dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { FIN: 1, ACK: 1 }, conn.seq, conn.ack), Proto.TCP_DATA_RETRY);
          conn.seq++;
        } else if (conn.state === 'CLOSE_WAIT') {   // 被动端应用决定关闭
          conn.state = 'LAST_ACK';
          this._send(conn.dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { FIN: 1, ACK: 1 }, conn.seq, conn.ack), Proto.TCP_DATA_RETRY);
          conn.seq++;
        }
        Bus.emit('device:changed', conn.dev.id);
      },

      abort(conn, silent) {                         // 本地放弃（关机 / Ctrl+C）
        this._clearRt(conn);
        this._drop(conn);
        if (!silent && conn.app.onErr) conn.app.onErr('aborted');
        Bus.emit('device:changed', conn.dev.id);
      },

      _drop(conn) {
        const arr = this.connsOf(conn.dev);
        const i = arr.indexOf(conn); if (i >= 0) arr.splice(i, 1);
        (conn._timers || []).forEach(Engine.cancel, Engine);
        conn.state = 'CLOSED';
      },

      _send(dev, conn, seg, retries) {
        this._clearRt(conn);
        const emit = () => Proto.sendIp(dev, conn.remoteIp, seg, {
          srcIp: conn.localIp === '0.0.0.0' ? undefined : conn.localIp, ttl: 128,
        });
        /* 该段占用序号空间的末尾（SYN/FIN 各占 1，数据占 len）——用于判断 ACK 是否覆盖 */
        const end = seg.seq + (seg.dataLen || 0) + (seg.flags.SYN ? 1 : 0) + (seg.flags.FIN ? 1 : 0);
        conn._rt = { seg, emit, retries, timer: null, end };
        const arm = () => {
          if (!conn._rt || conn._rt.seg !== seg) return;
          if (conn._rt.retries-- <= 0) {            // 重传耗尽：报告失败
            this._clearRt(conn);
            if (seg.flags.SYN && !seg.flags.ACK) {  // SYN 没有应答
              conn.state = 'CLOSED';
              if (conn.app.onErr) conn.app.onErr('timeout');
              this._drop(conn);
            }
            Bus.emit('device:changed', dev.id);
            return;
          }
          NS.log(`${dev.name}: 重传 ${this.segInfo(seg)}`, 'warn');
          emit();
          conn._rt.timer = Engine.schedule(Proto.TCP_RTO * (3 - conn._rt.retries), arm, 'tcp-rto');
        };
        emit();
        conn._rt.timer = Engine.schedule(Proto.TCP_RTO, arm, 'tcp-rto');
      },

      _clearRt(conn) { if (conn && conn._rt) { Engine.cancel(conn._rt.timer); conn._rt = null; } },

      _mslTimer(conn) {
        conn._timers = conn._timers || [];
        const t = Engine.schedule(2 * Proto.MSL, () => {
          NS.log(`${conn.dev.name}: TIME_WAIT 结束，连接关闭`, 'ok');
          this.historyOf(conn.dev).finClosed++;
          this._drop(conn);
          Bus.emit('device:changed', conn.dev.id);
        }, 'timewait');
        conn._timers.push(t);
      },

      /* 应用视角的"连接已关闭"：己方 FIN 已被确认 / 被动端完成 LAST_ACK */
      _notifyClosed(conn) {
        if (conn.app.onClose && !conn._closedNotified) { conn._closedNotified = true; conn.app.onClose(); }
      },

      /* TCP 段入站 */
      inbound(dev, ifce, ipPkt, seg) {
        const ip = ipPkt.ip;
        const conns = this.connsOf(dev);

        /* 已有连接匹配 */
        const conn = conns.find(c => c.remoteIp === ip.src && c.remotePort === seg.sport && c.localPort === seg.dport);

        if (seg.flags.RST) {
          if (conn) {
            conn.state = 'CLOSED';
            this._clearRt(conn); this._drop(conn);
            if (conn.app.onErr) conn.app.onErr('refused');
          }
          Bus.emit('device:changed', dev.id);
          return;
        }

        if (!conn) {
          /* 主动端先收到 SYN → 这是被监听端 */
          if (seg.flags.SYN && !seg.flags.ACK) {
            const svc = this.listenersOf(dev).get(seg.dport);
            if (svc) {
              const nconn = {
                id: this._cid++, dev, side: 'passive',
                localIp: ifce.ip, localPort: seg.dport, remoteIp: ip.src, remotePort: seg.sport,
                state: 'SYN_RCVD', seq: 5000 + Math.floor(Math.random() * 1000), ack: seg.seq + 1,
                app: this._serverApp(dev, svc),
              };
              nconn.seq++;
              conns.push(nconn);
              this._helpers(nconn);
              this._send(dev, nconn, Frames.tcp(seg.dport, seg.sport, { SYN: 1, ACK: 1 }, nconn.seq - 1, nconn.ack), Proto.TCP_SYN_RETRY);
              NS.log(`${dev.name}: 端口 ${seg.dport} 收到 SYN，回复 SYN+ACK`, 'info');
              Bus.emit('device:changed', dev.id);
            } else {
              /* 端口未监听 → RST */
              NS.log(`${dev.name}: 端口 ${seg.dport} 未监听，发送 RST`, 'warn');
              Proto.sendIp(dev, ip.src, Frames.tcp(seg.dport, seg.sport, { RST: 1, ACK: 1 }, 0, seg.seq + 1), { ttl: 128 });
            }
          }
          return;
        }

        /* ── 状态机 ── */
        const st = conn.state;
        /* 对方 ACK 覆盖了未确认段 → 停止重传 */
        if (seg.flags.ACK && conn._rt && seg.ack >= conn._rt.end) this._clearRt(conn);

        if (st === 'SYN_SENT' && seg.flags.SYN && seg.flags.ACK) {
          conn.ack = seg.seq + 1;
          this._clearRt(conn);
          this._send(dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
          conn.state = 'ESTABLISHED';
          this.historyOf(dev).established++;
          NS.log(`${dev.name}: TCP 连接建立 ${this.connName(conn)}`, 'ok');
          if (conn.app.onOpen) conn.app.onOpen(conn);
        } else if (st === 'SYN_RCVD' && seg.flags.ACK && !seg.flags.SYN) {
          this._clearRt(conn);
          conn.state = 'ESTABLISHED';
          this.historyOf(dev).established++;
          NS.log(`${dev.name}: 三次握手完成 ${this.connName(conn)}`, 'ok');
          if (conn.app.onOpen) conn.app.onOpen(conn);
        } else if (st === 'ESTABLISHED' && seg.flags.ACK) {
          if (seg.dataLen > 0) {
            conn.ack = seg.seq + seg.dataLen;
            /* 数据先 ACK，再交应用 */
            this._send(dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
            if (conn.app.onData) conn.app.onData(conn, seg.data);
            if (seg.flags.FIN) { /* 数据+FIN 合并的罕见情形：按 FIN 处理 */ this._passiveFin(dev, conn, seg); }
          } else if (seg.flags.FIN) {
            this._passiveFin(dev, conn, seg);
          }
        } else if (st === 'FIN_WAIT_1' && seg.flags.ACK && seg.flags.FIN) {   // 合并挥手：ACK+FIN 一起
          conn.ack = seg.seq + 1;
          this._send(dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
          conn.state = 'CLOSING';
        } else if (st === 'FIN_WAIT_1' && seg.flags.ACK && !seg.flags.FIN) {
          this._clearRt(conn);
          conn.state = 'FIN_WAIT_2';
          this._notifyClosed(conn);                   /* 己方 FIN 已确认：应用层关闭 */
          Bus.emit('device:changed', dev.id);
        } else if (st === 'FIN_WAIT_2' && seg.flags.FIN) {
          this._passiveAckFin(dev, conn, seg);
        } else if (st === 'CLOSING' && seg.flags.ACK) {
          this._clearRt(conn);
          conn.state = 'TIME_WAIT'; this._mslTimer(conn);
          this._notifyClosed(conn);
          Bus.emit('device:changed', dev.id);
        } else if (st === 'LAST_ACK' && seg.flags.ACK) {
          /* 被动关闭端收到最终 ACK → 连接完全关闭 */
          this._clearRt(conn);
          this.historyOf(dev).finClosed++;
          NS.log(`${dev.name}: LAST_ACK 收到最终 ACK，连接关闭 ${this.connName(conn)}`, 'ok');
          this._notifyClosed(conn);
          this._drop(conn);
        } else if ((st === 'FIN_WAIT_1' || st === 'FIN_WAIT_2') && seg.flags.FIN && seg.flags.ACK && st === 'FIN_WAIT_1') {
          /* 兜底（上面已处理合并情形） */
        }
        if (st !== conn.state) Bus.emit('device:changed', dev.id);
      },

      _passiveFin(dev, conn, seg) {                 // ESTABLISHED 收到 FIN → CLOSE_WAIT
        conn.ack = seg.seq + 1;
        this._send(dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
        conn.state = 'CLOSE_WAIT';
        NS.log(`${dev.name}: 收到 FIN，进入 CLOSE_WAIT ${this.connName(conn)}`, 'info');
        if (conn.app.onPeerFin) conn.app.onPeerFin(conn);
        else if (conn.app.onClose) conn.app.onClose();
      },
      _passiveAckFin(dev, conn, seg) {              // FIN_WAIT_2 收到 FIN → ACK + TIME_WAIT
        conn.ack = seg.seq + 1;
        this._send(dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
        conn.state = 'TIME_WAIT'; this._mslTimer(conn);
        NS.log(`${dev.name}: 四次挥手完成，进入 TIME_WAIT`, 'ok');
      },

      /* 服务端应用：HTTP / Telnet */
      _serverApp(dev, svc) {
        const self = this;
        const send = (conn, s) => self.send(conn, s);
        if (svc === 'http') {
          let gotReq = false;
          return {
            onOpen(conn) { NS.log(`${dev.name}: HTTP 客户端接入`, 'info'); },
            onData(conn, data) {
              if (!gotReq) {
                gotReq = true;
                const body = `<html><body><h1>Hello from ${dev.name}</h1></body></html>`;
                const resp = `HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
                send(conn, resp);
                Engine.schedule(60, () => self.close(conn), 'http-close');   // 响应完服务器主动挥手
              }
            },
            onPeerFin(conn) { self.close(conn); },
          };
        }
        /* telnet */
        return {
          onOpen(conn) { send(conn, `Welcome to ${dev.name} telnet service.\r\nType anything, or 'quit' to close.\r\n`); },
          onData(conn, data) {
            const line = (data || '').trim();
            if (line.toLowerCase() === 'quit') {
              send(conn, 'Goodbye.\r\n');            /* 客户端收到后主动挥手 */
            } else {
              send(conn, `[${dev.name}] echo: ${line}\r\n`);
            }
          },
          onPeerFin(conn) { Engine.schedule(30, () => self.close(conn), 'telnet-close2'); },
        };
      },

      segInfo(seg) {
        const fl = Object.keys(seg.flags).filter(k => seg.flags[k]);
        return `${seg.sport}→${seg.dport} [${fl.join(', ')}] seq=${seg.seq}`;
      },
      connName(c) { return `${c.localIp}:${c.localPort} ↔ ${c.remoteIp}:${c.remotePort}`; },
    },

    /* ───── IP 入站（host/router 共用） ───── */
    ipInbound(dev, ifce, ipPkt) {
      const ip = ipPkt.ip, me = ip.dst === ifce.ip;

      if (me || ip.dst === '127.0.0.1') {
        const l4 = ipPkt.payload;
        if (ip.proto === 'ICMP') this.icmpInbound(dev, ifce, ipPkt, l4);
        else if (ip.proto === 'TCP') this.tcp.inbound(dev, ifce, ipPkt, l4);
        else if (ip.proto === 'UDP') { /* 预留 */ }
        return;
      }

      if (dev.type === 'router') this.forward(dev, ifce, ipPkt);
      /* 主机不转发，直接丢弃 */
    },

    /* ───── 路由器转发 ───── */
    forward(dev, inIf, ipPkt) {
      const ip = ipPkt.ip;
      const l4 = ipPkt.payload;
      const newTtl = ip.ttl - 1;

      if (newTtl <= 0) {
        NS.log(`${dev.name}: TTL 超时，向 ${ip.src} 发送 ICMP Time Exceeded`, 'warn');
        Proto.sendIp(dev, ip.src, Frames.icmp(11, 0, (l4.echoId != null ? l4.echoId : 0), (l4.seq || 0), 0, ip.dst), { srcIp: inIf.ip, ttl: 128, errCb: () => {} });
        return;
      }

      const r = this.routerRoute(dev, ip.dst);
      if (r.err) {
        NS.log(`${dev.name}: 无到 ${ip.dst} 的路由，发送 ICMP 不可达(code 0)`, 'warn');
        Proto.sendIp(dev, ip.src, Frames.icmp(3, 0, (l4.echoId != null ? l4.echoId : 0), (l4.seq || 0), 0, ip.dst), { srcIp: inIf.ip, ttl: 128, errCb: () => {} });
        return;
      }

      this.arpResolve(dev, r.ifce, r.nextHop, (err, mac) => {
        if (err) {   // 最后一级 ARP 失败 → host unreachable
          NS.log(`${dev.name}: 下一跳 ${r.nextHop} ARP 失败，发送 ICMP 不可达(code 1)`, 'warn');
          Proto.sendIp(dev, ip.src, Frames.icmp(3, 1, (l4.echoId != null ? l4.echoId : 0), (l4.seq || 0), 0, ip.dst), { srcIp: inIf.ip, ttl: 128, errCb: () => {} });
          return;
        }
        ip.ttl = newTtl;   // 就地递减（同一 IP 包跨跳复用，展示逐跳递减）
        Net.tx(dev, r.ifce, { eth: { dst: mac, src: r.ifce.mac, type: 'IPv4' }, payload: ipPkt, len: 34 + (l4 ? l4.len : 0) });
        NS.log(`${dev.name}: 转发 → ${ip.dst} (TTL=${newTtl}, 下一跳 ${r.nextHop})`, 'info');
      });
    },

    /* ══════════ 为设备挂协议栈 ══════════ */
    attachHostStack(dev) {
      dev.receiveFrame = (frame, ifce) => {
        if (!dev.on || !ifce) return;
        if (frame.eth.dst !== ifce.mac && !IP.isBroadcast(frame.eth.dst)) return;
        const p = frame.payload;
        if (frame.eth.type === 'ARP') this.arpInbound(dev, ifce, p);
        else if (frame.eth.type === 'IPv4') this.ipInbound(dev, ifce, frame.payload);
      };
      dev.powerOffCleanup = () => {                  // 关机：掐断所有 TCP 连接
        (this.tcp.connsOf(dev).slice()).forEach(c => this.tcp.abort(c, true));
        Bus.emit('device:changed', dev.id);
      };
    },

    attachRouterStack(dev) {
      this.attachHostStack(dev);                     // 路由器自身同样收发（ICMP/TCP to self）
    },

    attachSwitchStack(dev) {
      dev.receiveFrame = (frame, port) => {          // port: 接口对象（端口名）
        if (!dev.on || !port) return;
        const src = frame.eth.src;
        if (!IP.isBroadcast(src)) {                  // 学习源 MAC
          dev.macTable.set(src, { port: port.name, t: Engine.time });
          Bus.emit('device:changed', dev.id);
        }
        const dst = frame.eth.dst;
        const hit = IP.isBroadcast(dst) ? null : dev.macTable.get(dst);
        if (hit && Engine.time - hit.t <= this.MAC_AGE) {
          if (hit.port !== port.name) {              // 已知单播：仅发对应端口
            const outIf = dev.getInterface(hit.port);
            if (outIf) Net.tx(dev, outIf, frame);
          }
        } else {                                     // 未知/广播：泛洪
          dev.interfaces.filter(i => i.name !== port.name && i.linkId).forEach(outIf => Net.tx(dev, outIf, frame));
        }
      };
      dev.powerOffCleanup = () => { dev.macTable.clear(); Bus.emit('device:changed', dev.id); };
    },
  };

  NS.Proto = Proto;
})(typeof window !== 'undefined' ? window : globalThis);
