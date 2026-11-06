/* ═══════════════ protocols.js — 协议栈（ARP / IPv4 / ICMP / TCP） ═══════════════
 * 与 devices.js 配合：devices 定义数据模型，本文件通过 attach*Stack(dev)
 * 为设备挂上协议行为（发送 / 接收 / 转发）。
 *
 * 报文模型（模拟真实封装层级）：
 *   frame  = { eth:{dst,src,type}, payload, len }
 *   arp    = { op:1|2, sha, spa, tha, tpa }
 *   ipPkt  = { ip:{src,dst,ttl,proto,id}, payload }
 *   icmp   = { type:8|0|11|3, code, dataLen, echoId?, seq?, quote? }
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
    isLoopback(ip) { return IP.valid(ip) && (IP.parse(ip) >>> 24) === 127; },
  };
  NS.IP = IP;

  /* Windows 风格 MAC 显示：00-50-56-0A-00-01 */
  NS.macWin = (m) => (m || '').replace(/:/g, '-').toUpperCase();

  /* ══════════ 报文工厂 ══════════ */
  let ipId = 1, flightId = 1, nextEchoId = 0x1001;
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
    icmp(type, code, echoId, seq, dataLen) {
      return { proto: 'ICMP', type, code, echoId, seq, dataLen, len: 8 + (dataLen || 0) };
    },
    icmpError(type, code, packet) {
      const { ip, payload } = packet;
      // ICMP 错误引用原 IP 头和传输层开头。TCP 只需端口与序号即可匹配发送方。
      const transport = ip.proto === 'TCP'
        ? { sport: payload.sport, dport: payload.dport, seq: payload.seq }
        : { type: payload.type, echoId: payload.echoId, seq: payload.seq };
      return { proto: 'ICMP', type, code, quote: { ip: { ...ip }, payload: transport }, dataLen: 28, len: 36 };
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
      if (!dev.on || NS.world.devices.get(dev.id) !== dev) return false;
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
        if (peer.on && NS.world.devices.get(peer.id) === peer && NS.world.links.get(link.id) === link && link.up) {
          peer.receiveFrame(frame, peer.getInterface(other.ifName));
        }
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
        this.arpLearn(dev, ifce.name, arp.spa, arp.sha);
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
      const route = this.routerRoute(dev, dstIp);
      if (!route.err) return route;
      const gwIf = dev.interfaces.find(ifce => ifce.gw);
      if (gwIf) {
        if (gwIf.ip && gwIf.mask && IP.inSubnet(gwIf.gw, gwIf.ip, gwIf.mask)) return { ifce: gwIf, nextHop: gwIf.gw };
        return { err: 'badgw' };
      }
      return { err: 'noroute' };
    },

    /* 路由器路由：直连 + 静态最长前缀匹配 */
    routerRoute(dev, dstIp) {
      let best = null;
      for (const ifce of dev.interfaces) {
        if (!ifce.ip || !ifce.mask) continue;
        const len = IP.maskLen(ifce.mask);
        if (IP.inSubnet(dstIp, ifce.ip, ifce.mask) && (!best || len > best.len)) {
          best = { ifce, nextHop: dstIp, len };
        }
      }
      for (const r of (dev.staticRoutes || [])) {
        if (!IP.valid(r.dest) || !IP.validMask(r.mask) || !IP.valid(r.nh)) continue;
        if (!IP.inSubnet(dstIp, r.dest, r.mask)) continue;
        const len = IP.maskLen(r.mask);
        if (best && len <= best.len) continue;
        const nhIf = dev.interfaces
          .filter(ifce => ifce.ip && ifce.mask && IP.inSubnet(r.nh, ifce.ip, ifce.mask))
          .sort((a, b) => IP.maskLen(b.mask) - IP.maskLen(a.mask))[0];
        if (nhIf) best = { ifce: nhIf, nextHop: r.nh, len };
      }
      return best || { err: 'noroute' };
    },

    localInterface(dev, ip) {
      if (!IP.valid(ip)) return null;
      if (IP.isLoopback(ip)) return { name: 'lo', ip, mac: '00:00:00:00:00:00' };
      return dev.interfaces.find(ifce => ifce.ip === ip) || null;
    },

    /* ───── 发送 IP 包（主机与路由器共用入口） ─────
     * srcIf 可省略（自动选择）。opts.errCb 接收 'noroute'/'badgw'/'arptimeout'。 */
    sendIp(dev, dstIp, l4, opts = {}) {
      if (!dev.on || NS.world.devices.get(dev.id) !== dev) return;
      const localIf = this.localInterface(dev, dstIp);
      if (localIf) {
        const packet = Frames.ip(localIf.mac, localIf.mac, opts.srcIp || dstIp, dstIp,
          opts.ttl ?? 128, l4.proto, l4).payload;
        Engine.schedule(0, () => {
          if (opts.cancelled && opts.cancelled()) return;
          if (dev.on && NS.world.devices.get(dev.id) === dev) this.ipInbound(dev, localIf, packet);
        }, 'local-ip');
        return;
      }
      const r = dev.type === 'router' ? this.routerRoute(dev, dstIp) : this.hostRoute(dev, dstIp);
      if (r.err) {
        NS.log(`${dev.name}: 无到 ${dstIp} 的路由`, 'warn');
        if (opts.errCb) opts.errCb(r.err);
        return;
      }
      const srcIp = opts.srcIp || (r.ifce.ip || '0.0.0.0');
      this.arpResolve(dev, r.ifce, r.nextHop, (err, mac) => {
        if (opts.cancelled && opts.cancelled()) return;
        if (err) { if (opts.errCb) opts.errCb('arptimeout'); return; }
        Net.tx(dev, r.ifce, Frames.ip(r.ifce.mac, mac, srcIp, dstIp, opts.ttl == null ? 128 : opts.ttl, l4.proto, l4));
      });
    },

    /* ───── ICMP 探测（ping / tracert / 实验验收共用） ─────
     * onDone(result):
     *   {kind:'reply', from, ms, ttl}  正常回复
     *   {kind:'timeout'}               超时 / ARP 失败
     *   {kind:'tlexceeded', from, ms}   TTL 超时（tracert 中间跳）
     *   {kind:'unreachable', from, ms, code}  目标不可达
     *   {kind:'noroute'}               本机无路由（传输失败） */
    icmpEcho(dev, dstIp, { echoId = nextEchoId++, seq = 1, ttl = 128, size = 32, timeout } = {}, onDone) {
      if (!dev.icmpCbs) dev.icmpCbs = new Map();
      let done = false;
      const cancel = () => {
        if (done) return false;
        done = true;
        Engine.cancel(timer);
        if (dev.icmpCbs.get(echoId) === entry) dev.icmpCbs.delete(echoId);
        return true;
      };
      const finish = (res) => { if (cancel()) onDone(res); };
      const sentAt = Engine.time;
      const entry = { finish, sentAt };
      dev.icmpCbs.set(echoId, entry);
      const timer = Engine.schedule(timeout || this.ICMP_TIMEOUT, () => finish({ kind: 'timeout' }), `icmp-timeout ${dstIp}`);

      this.sendIp(dev, dstIp, Frames.icmp(8, 0, echoId, seq, size), {
        ttl,
        cancelled: () => done,
        errCb: (e) => finish(e === 'arptimeout' ? { kind: 'timeout', arp: true } : { kind: 'noroute' }),
      });
      return cancel;
    },

    /* ICMP 入站处理（目标是自己） */
    icmpInbound(dev, ifce, ipPkt, icmp) {
      const ip = ipPkt.ip;
      if (icmp.type === 8) {                       // echo request → 回复
        this.sendIp(dev, ip.src, Frames.icmp(0, 0, icmp.echoId, icmp.seq, icmp.dataLen), { ttl: 128, srcIp: ip.dst });
        return;
      }
      if (icmp.type === 0) {
        const entry = dev.icmpCbs?.get(icmp.echoId);
        if (entry) entry.finish({ kind: 'reply', from: ip.src, ms: Engine.time - entry.sentAt, ttl: ip.ttl });
        return;
      }
      if (icmp.type !== 3 && icmp.type !== 11) return;
      const quote = icmp.quote;
      if (!quote || quote.ip.src !== ip.dst) return;
      if (quote.ip.proto === 'TCP') {
        this.tcp.icmpError(dev, icmp, ip.src);
        return;
      }
      if (quote.ip.proto !== 'ICMP' || quote.payload.type !== 8) return;
      const entry = dev.icmpCbs?.get(quote.payload.echoId);
      if (!entry) return;
      const ms = Engine.time - entry.sentAt;
      if (icmp.type === 11) entry.finish({ kind: 'tlexceeded', from: ip.src, ms });
      else entry.finish({ kind: 'unreachable', from: ip.src, ms, code: icmp.code });
    },

    /* ───── TCP ───── */
    tcp: {
      /* conn: {id, dev, side:'active'|'passive', localIp, localPort, remoteIp, remotePort,
       *        state, seq, ack, app:{onOpen,onData,onClose,onErr}, _unacked:[], _timeWaitTimer} */
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
        const route = dev.type === 'router' ? Proto.routerRoute(dev, dstIp) : Proto.hostRoute(dev, dstIp);
        const srcIf = Proto.localInterface(dev, dstIp) || route.ifce || dev.interfaces.find(i => i.ip);
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
        if (!this.isOpen(conn)) return;
        const state = conn.state;
        this._drop(conn);
        if (state !== 'SYN_SENT' && state !== 'TIME_WAIT') {
          const rst = Frames.tcp(conn.localPort, conn.remotePort, { RST: 1 }, conn.seq, 0);
          Proto.sendIp(conn.dev, conn.remoteIp, rst, { srcIp: conn.localIp });
        }
        if (!silent && conn.app.onErr) conn.app.onErr('aborted');
        Bus.emit('device:changed', conn.dev.id);
      },

      icmpError(dev, { type, code, quote }, from) {
        // 当前路由器只生成网络/主机不可达及 TTL 超时，三者均为软错误。
        if (type === 3 && code !== 0 && code !== 1) return;
        const { ip, payload } = quote;
        const conn = this.connsOf(dev).find(c => c.localIp === ip.src && c.remoteIp === ip.dst &&
          c.localPort === payload.sport && c.remotePort === payload.dport);
        const record = conn?._unacked?.find(r => r.seg.seq === payload.seq);
        if (!record) return;
        const previous = record.icmpError;
        if (previous?.type === type && previous.code === code && previous.from === from) return;
        // 不可达和 TTL 超时可能由暂时故障导致，告知应用并继续重传。
        record.icmpError = { type, code, from };
        conn.app.onNetworkError?.(record.icmpError);
      },

      _fail(conn, reason, detail) {
        this._drop(conn);
        conn.app.onErr?.(reason, detail);
        Bus.emit('device:changed', conn.dev.id);
      },

      _drop(conn) {
        this._clearRt(conn);
        Engine.cancel(conn._timeWaitTimer);
        const arr = this.connsOf(conn.dev);
        const i = arr.indexOf(conn); if (i >= 0) arr.splice(i, 1);
        conn.state = 'CLOSED';
      },

      _send(dev, conn, seg, retries) {
        const pending = conn._unacked = conn._unacked || [];
        const length = seg.dataLen + Number(seg.flags.SYN) + Number(seg.flags.FIN);
        const record = { seg, retries, timer: null, end: seg.seq + length, rto: Proto.TCP_RTO };
        // 纯 ACK 不占序号，也不能取消其他未确认报文的重传。
        if (length) pending.push(record);
        const emit = () => Proto.sendIp(dev, conn.remoteIp, seg, {
          srcIp: conn.localIp === '0.0.0.0' ? undefined : conn.localIp, ttl: 128,
          cancelled: () => conn.state === 'CLOSED' || (length && !pending.includes(record)),
          errCb: reason => {
            if (conn.state === 'SYN_SENT' && (reason === 'noroute' || reason === 'badgw')) this._fail(conn, reason);
          },
        });
        record.emit = emit;
        const arm = () => {
          if (!pending.includes(record) || conn.state === 'CLOSED') return;
          if (record.retries-- <= 0) {
            NS.log(`${dev.name}: TCP 重传超时，连接关闭`, 'warn');
            this._fail(conn, record.icmpError ? 'icmp' : 'timeout', record.icmpError);
            return;
          }
          NS.log(`${dev.name}: 重传 ${this.segInfo(seg)}`, 'warn');
          record.rto *= 2;
          record.timer = Engine.schedule(record.rto, arm, 'tcp-rto');
          emit();
        };
        if (length) record.timer = Engine.schedule(record.rto, arm, 'tcp-rto');
        emit();
      },

      _clearRt(conn) {
        for (const record of (conn._unacked || [])) Engine.cancel(record.timer);
        if (conn._unacked) conn._unacked.length = 0;
      },

      _acknowledge(conn, ack) {
        const pending = conn._unacked || [];
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i].end <= ack) {
            Engine.cancel(pending[i].timer);
            pending.splice(i, 1);
          }
        }
      },

      _sendAck(conn) {
        this._send(conn.dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
      },

      _mslTimer(conn) {
        Engine.cancel(conn._timeWaitTimer);
        conn._timeWaitTimer = Engine.schedule(2 * Proto.MSL, () => {
          NS.log(`${conn.dev.name}: TIME_WAIT 结束，连接关闭`, 'ok');
          this.historyOf(conn.dev).finClosed++;
          this._drop(conn);
          Bus.emit('device:changed', conn.dev.id);
        }, 'timewait');
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
        const conn = conns.find(c => c.localIp === ip.dst && c.remoteIp === ip.src && c.remotePort === seg.sport && c.localPort === seg.dport);

        if (seg.flags.RST) {
          if (conn) this._fail(conn, conn.state === 'SYN_SENT' ? 'refused' : 'reset');
          return;
        }

        if (!conn) {
          /* 主动端先收到 SYN → 这是被监听端 */
          if (seg.flags.SYN && !seg.flags.ACK) {
            const svc = this.listenersOf(dev).get(seg.dport);
            if (svc) {
              const nconn = {
                id: this._cid++, dev, side: 'passive',
                localIp: ip.dst, localPort: seg.dport, remoteIp: ip.src, remotePort: seg.sport,
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
              Proto.sendIp(dev, ip.src, Frames.tcp(seg.dport, seg.sport, { RST: 1, ACK: 1 }, 0, seg.seq + 1), { ttl: 128, srcIp: ip.dst });
            }
          } else if (seg.flags.SYN && seg.flags.ACK) {
            // 客户端已中断握手时，通知对端清理半开连接。
            const rst = Frames.tcp(seg.dport, seg.sport, { RST: 1 }, seg.ack, 0);
            Proto.sendIp(dev, ip.src, rst, { srcIp: ip.dst });
          }
          return;
        }

        /* 握手及重复 SYN：第三次 ACK 丢失时仍能恢复。 */
        if (conn.state === 'SYN_SENT') {
          if (!seg.flags.SYN || !seg.flags.ACK || seg.ack !== conn.seq) return;
          conn.ack = seg.seq + 1;
          this._acknowledge(conn, seg.ack);
          this._sendAck(conn);
          conn.state = 'ESTABLISHED';
          this.historyOf(dev).established++;
          NS.log(`${dev.name}: TCP 连接建立 ${this.connName(conn)}`, 'ok');
          if (conn.app.onOpen) conn.app.onOpen(conn);
          Bus.emit('device:changed', dev.id);
          return;
        }
        if (seg.flags.SYN) {
          if (conn.state === 'SYN_RCVD' && seg.seq + 1 === conn.ack) {
            const syn = (conn._unacked || []).find(record => record.seg.flags.SYN);
            if (syn) syn.emit();
          } else if (seg.flags.ACK && seg.seq + 1 <= conn.ack) {
            this._sendAck(conn);
          }
          return;
        }
        if (!seg.flags.ACK) return;
        if (seg.ack > conn.seq) { this._sendAck(conn); return; }

        // 重复或乱序的数据/FIN 只确认已连续收到的字节，不重复交给应用。
        if ((seg.dataLen || seg.flags.FIN) && seg.seq !== conn.ack) {
          this._sendAck(conn);
          if (conn.state === 'TIME_WAIT' && seg.flags.FIN && seg.seq + 1 === conn.ack) this._mslTimer(conn);
          return;
        }
        const st = conn.state;
        if (st === 'SYN_RCVD' && (seg.ack !== conn.seq || seg.seq !== conn.ack)) return;
        this._acknowledge(conn, seg.ack);
        if (conn.state === 'SYN_RCVD') {
          conn.state = 'ESTABLISHED';
          this.historyOf(dev).established++;
          NS.log(`${dev.name}: 三次握手完成 ${this.connName(conn)}`, 'ok');
          if (conn.app.onOpen) conn.app.onOpen(conn);
        }

        if (conn.state === 'FIN_WAIT_1' && seg.ack === conn.seq) {
          conn.state = 'FIN_WAIT_2';
          this._notifyClosed(conn);
        } else if (conn.state === 'CLOSING' && seg.ack === conn.seq) {
          conn.state = 'TIME_WAIT'; this._mslTimer(conn);
          this._notifyClosed(conn);
        } else if (conn.state === 'LAST_ACK' && seg.ack === conn.seq) {
          this.historyOf(dev).finClosed++;
          NS.log(`${dev.name}: LAST_ACK 收到最终 ACK，连接关闭 ${this.connName(conn)}`, 'ok');
          this._notifyClosed(conn);
          this._drop(conn);
        }

        if (seg.dataLen && ['ESTABLISHED', 'FIN_WAIT_1', 'FIN_WAIT_2'].includes(conn.state)) {
          conn.ack += seg.dataLen;
          this._sendAck(conn);
          if (conn.app.onData) conn.app.onData(conn, seg.data);
        }
        if (seg.flags.FIN) {
          if (conn.state === 'ESTABLISHED') this._passiveFin(dev, conn, seg);
          else if (conn.state === 'FIN_WAIT_2') this._passiveAckFin(dev, conn, seg);
          else if (conn.state === 'FIN_WAIT_1') {
            conn.ack = seg.seq + seg.dataLen + 1;
            this._sendAck(conn);
            conn.state = 'CLOSING';
          }
        }
        if (st !== conn.state) Bus.emit('device:changed', dev.id);
      },

      _passiveFin(dev, conn, seg) {                 // ESTABLISHED 收到 FIN → CLOSE_WAIT
        conn.ack = seg.seq + seg.dataLen + 1;
        this._send(dev, conn, Frames.tcp(conn.localPort, conn.remotePort, { ACK: 1 }, conn.seq, conn.ack), 0);
        conn.state = 'CLOSE_WAIT';
        NS.log(`${dev.name}: 收到 FIN，进入 CLOSE_WAIT ${this.connName(conn)}`, 'info');
        if (conn.app.onPeerFin) conn.app.onPeerFin(conn);
        else if (conn.app.onClose) conn.app.onClose();
      },
      _passiveAckFin(dev, conn, seg) {              // FIN_WAIT_2 收到 FIN → ACK + TIME_WAIT
        conn.ack = seg.seq + seg.dataLen + 1;
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
      const ip = ipPkt.ip;
      if (IP.isLoopback(ip.dst) && ifce.name !== 'lo') return;
      const me = this.localInterface(dev, ip.dst);

      if (me) {
        const l4 = ipPkt.payload;
        if (ip.proto === 'ICMP') this.icmpInbound(dev, ifce, ipPkt, l4);
        else if (ip.proto === 'TCP') this.tcp.inbound(dev, ifce, ipPkt, l4);
        else if (ip.proto === 'UDP') { /* 预留 */ }
        return;
      }

      if (dev.type === 'router') this.forward(dev, ifce, ipPkt);
      /* 主机不转发，直接丢弃 */
    },

    sendIcmpError(dev, inIf, packet, type, code) {
      // 已经是 ICMP 错误的报文无需再返回错误。
      if (packet.ip.proto === 'ICMP' && (packet.payload.type === 3 || packet.payload.type === 11)) return;
      this.sendIp(dev, packet.ip.src, Frames.icmpError(type, code, packet), { srcIp: inIf.ip });
    },

    /* ───── 路由器转发 ───── */
    forward(dev, inIf, ipPkt) {
      const ip = ipPkt.ip;
      const l4 = ipPkt.payload;
      const newTtl = ip.ttl - 1;

      if (newTtl <= 0) {
        NS.log(`${dev.name}: TTL 超时，向 ${ip.src} 发送 ICMP Time Exceeded`, 'warn');
        this.sendIcmpError(dev, inIf, ipPkt, 11, 0);
        return;
      }

      const r = this.routerRoute(dev, ip.dst);
      if (r.err) {
        NS.log(`${dev.name}: 无到 ${ip.dst} 的路由，发送 ICMP 不可达(code 0)`, 'warn');
        this.sendIcmpError(dev, inIf, ipPkt, 3, 0);
        return;
      }

      this.arpResolve(dev, r.ifce, r.nextHop, (err, mac) => {
        if (err) {   // 最后一级 ARP 失败 → host unreachable
          NS.log(`${dev.name}: 下一跳 ${r.nextHop} ARP 失败，发送 ICMP 不可达(code 1)`, 'warn');
          this.sendIcmpError(dev, inIf, ipPkt, 3, 1);
          return;
        }
        const forwarded = { ...ipPkt, ip: { ...ip, ttl: newTtl } };
        Net.tx(dev, r.ifce, { eth: { dst: mac, src: r.ifce.mac, type: 'IPv4' }, payload: forwarded, len: 34 + (l4 ? l4.len : 0) });
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
