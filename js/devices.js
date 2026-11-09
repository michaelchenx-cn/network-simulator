/* ═══════════════ devices.js — 设备模型与世界注册表 ═══════════════
 * Host(PC/Server) / Router / Switch 三类设备 + Link 链路。
 * 协议行为由 protocols.js 的 attach*Stack() 挂载。
 * 序列化仅保存配置（IP/路由/服务），运行态（ARP/TCP/MAC表）不保存。
 */
(function (root) {
  const NS = root.NS = root.NS || {};
  const Proto = () => NS.Proto;

  const world = {
    devices: new Map(),
    links: new Map(),

    addDevice(d) { this.devices.set(d.id, d); NS.Bus.emit('world:changed'); return d; },
    removeDevice(id) {
      const d = this.devices.get(id); if (!d) return;
      if (NS.Terminals) NS.Terminals.cleanupDevice(id);
      [...this.links.values()].filter(l => l.a.dev === id || l.b.dev === id).forEach(l => this.removeLink(l.id));
      if (d.powerOffCleanup) d.powerOffCleanup();
      this.devices.delete(id);
      NS.Bus.emit('world:changed');
    },
    addLink(l) {
      this.links.set(l.id, l);
      NS.Bus.emit('world:changed');
      reportConflicts(l.endpoints()[0].ifce);
      return l;
    },
    removeLink(id) {
      const l = this.links.get(id); if (!l) return;
      [l.a, l.b].forEach(end => {
        const d = this.devices.get(end.dev);
        const ifce = d && d.getInterface(end.ifName);
        if (ifce) ifce.linkId = null;
      });
      this.links.delete(id);
      NS.Bus.emit('world:changed');
    },

    /* 自动选择空闲接口建立链路；返回 link 或 null（原因见 toast） */
    connect(devA, devB) {
      if (devA === devB) return null;
      const ifA = devA.getFreeInterface(), ifB = devB.getFreeInterface();
      if (!ifA || !ifB) { NS.Bus.emit('link:fail', ifA ? 'B' : (ifB ? 'A' : 'AB')); return null; }
      /* 已直连检测 */
      for (const l of this.links.values()) {
        if ((l.a.dev === devA.id && l.b.dev === devB.id) || (l.a.dev === devB.id && l.b.dev === devA.id)) { NS.Bus.emit('link:duplicate'); return null; }
      }
      const link = new Link(ifA, devA, ifB, devB);
      ifA.linkId = link.id; ifB.linkId = link.id;
      return this.addLink(link);
    },

    clear() {
      if (NS.Terminals) NS.Terminals.closeAll();
      this.devices.clear(); this.links.clear();
      NS.Engine.reset();
      NS.Logger.clear();
      counters = { pc: 0, router: 0, switch: 0, server: 0, mac: 0, link: 0 };
      if (NS.Sniffer) NS.Sniffer.clear();
      NS.Bus.emit('world:cleared');
    },
  };
  NS.world = world;

  let counters = { pc: 0, router: 0, switch: 0, server: 0, mac: 0, link: 0 };
  let nextDeviceId = 0;

  function genDeviceId(type) {
    let id;
    do {
      id = `${type[0]}-${Date.now().toString(36)}-${(++nextDeviceId).toString(36)}`;
    } while (world.devices.has(id) || counters.importIds?.has(id));
    return id;
  }

  /* 交换机端口和网线连接同一广播域，路由器的各接口彼此独立。 */
  function addressConflicts(devices, links, onlyInterface) {
    const visited = new Set();
    const conflicts = [];
    for (const dev of devices.values()) for (const ifce of dev.interfaces) {
      if (visited.has(ifce) || (onlyInterface && ifce !== onlyInterface)) continue;
      const seen = { IP: new Map(), MAC: new Map() };
      const pending = [[dev, ifce]];
      while (pending.length) {
        const [owner, port] = pending.pop();
        if (visited.has(port)) continue;
        visited.add(port);
        const name = `${owner.name} · ${port.name}`;
        for (const [kind, address] of [['IP', port.ip], ['MAC', port.mac]]) {
          if (!address) continue;
          const first = seen[kind].get(address);
          if (first) conflicts.push({ kind, address, first, second: name });
          else seen[kind].set(address, name);
        }
        const link = links.get(port.linkId);
        if (link) {
          const end = link.otherEnd(owner.id);
          const peer = devices.get(end.dev);
          const peerPort = peer?.getInterface(end.ifName);
          if (peerPort) pending.push([peer, peerPort]);
        }
        if (owner.type === 'switch') owner.interfaces.forEach(i => pending.push([owner, i]));
      }
    }
    return conflicts;
  }

  function reportConflicts(ifce) {
    const conflicts = addressConflicts(world.devices, world.links, ifce);
    if (conflicts.length) NS.Bus.emit('address:conflict', conflicts);
  }

  function genMac() {
    const occupied = counters.importMacs ?? new Set([...world.devices.values()].flatMap(d => d.interfaces.map(i => i.mac)));
    const hex = (x) => x.toString(16).toUpperCase().padStart(2, '0');
    let mac;
    do {
      const n = ++counters.mac;
      mac = `00:50:56:${hex((n >> 16) & 0x7F | 0x20)}:${hex((n >> 8) & 0xFF)}:${hex(n & 0xFF)}`;
    } while (occupied.has(mac));
    return mac;
  }

  class Interface {
    constructor(name) { this.name = name; this.mac = genMac(); this.ip = ''; this.mask = ''; this.gw = ''; this.linkId = null; }
  }

  class Link {
    constructor(ifA, devA, ifB, devB) {
      this.id = 'L' + (++counters.link);
      this.a = { dev: devA.id, ifName: ifA.name };
      this.b = { dev: devB.id, ifName: ifB.name };
      this.delay = 4;       // 单向传播时延（仿真 ms）
      this.loss = 0;        // 丢包率 %
      this.up = true;
      this._names = [devA.name, devB.name];
    }
    name() {
      const dA = world.devices.get(this.a.dev), dB = world.devices.get(this.b.dev);
      return `${dA ? dA.name : this._names[0]} ↔ ${dB ? dB.name : this._names[1]}`;
    }
    otherEnd(devId) { return this.a.dev === devId ? this.b : this.a; }
    endpoints() {
      return [
        { dev: world.devices.get(this.a.dev), ifce: world.devices.get(this.a.dev) && world.devices.get(this.a.dev).getInterface(this.a.ifName) },
        { dev: world.devices.get(this.b.dev), ifce: world.devices.get(this.b.dev) && world.devices.get(this.b.dev).getInterface(this.b.ifName) },
      ];
    }
  }

  class Device {
    constructor(type, x, y) {
      this.id = genDeviceId(type);
      this.type = type;                    // pc | router | switch | server
      counters[type]++;
      this.name = (type === 'pc' ? 'PC' : type === 'router' ? 'Router' : type === 'switch' ? 'Switch' : 'Server') + counters[type];
      this.x = x; this.y = y;
      this.on = true;
      this.interfaces = [];
      this.staticRoutes = [];
      if (type === 'router') { this.interfaces.push(new Interface('ge0/0'), new Interface('ge0/1')); }
      else if (type === 'switch') { for (let i = 1; i <= 4; i++) this.interfaces.push(new Interface('port' + i)); this.macTable = new Map(); }
      else { this.interfaces.push(new Interface('eth0')); }
      if (type === 'server') { this.services = { http: true, telnet: true }; }

      /* 挂协议栈 */
      const P = Proto();
      if (type === 'switch') P.attachSwitchStack(this); else P.attachHostStack(this);
      if (type === 'server') this.applyServices();
    }

    getInterface(name) { return this.interfaces.find(i => i.name === name) || null; }
    getFreeInterface() {
      const free = this.interfaces.find(i => !i.linkId);
      if (free) return free;
      if (this.type === 'switch' && this.interfaces.length < 12) {   // 交换机端口自动扩展
        const p = new Interface('port' + (this.interfaces.length + 1));
        this.interfaces.push(p); return p;
      }
      return null;
    }
    addRouterInterface() {                 // 路由器手动加接口（最多 4）
      if (this.type !== 'router' || this.interfaces.length >= 4) return null;
      const idx = this.interfaces.length;
      const names = ['ge0/0', 'ge0/1', 'ge0/2', 'ge0/3'];
      const ifce = new Interface(names[idx]);
      this.interfaces.push(ifce);
      NS.Bus.emit('world:changed');
      return ifce;
    }

    power(v) {
      this.on = v;
      if (!v) {
        NS.Terminals?.interruptOnPowerOff(this.id);
        this.powerOffCleanup?.();
      }
      NS.log({ zh: `${this.name}: ${v ? '开机' : '关机'}`, en: `${this.name}: ${v ? 'Powered on' : 'Powered off'}` }, v ? 'ok' : 'warn');
      NS.Bus.emit('device:changed', this.id);
      NS.Bus.emit('topology:touched');
    }

    applyServices() {                      // server: 同步监听端口
      if (this.type !== 'server') return;
      const listeners = Proto().tcp.listenersOf(this);
      for (const [service, port] of [['http', 80], ['telnet', 23]]) {
        if (this.services[service]) listeners.set(port, service);
        else listeners.delete(port);
      }
      if (world.devices.get(this.id) === this) {
        NS.Bus.emit('device:changed', this.id);
        NS.Bus.emit('topology:touched');
      }
    }

    setIfConfig(ifName, { ip, mask, gw }) {
      const ifce = this.getInterface(ifName); if (!ifce) return 'noif';
      const IP = NS.IP;
      if (ip !== undefined && ip !== '' && !IP.validUnicast(ip)) return 'badip';
      if (mask !== undefined && mask !== '' && !IP.validMask(mask)) return 'badip';
      if (gw !== undefined && gw !== '' && !IP.validUnicast(gw)) return 'badip';
      if (ip) ip = IP.normalize(ip);
      if (mask) mask = IP.normalize(mask);
      if (gw) gw = IP.normalize(gw);
      const changedIp = ip !== undefined && ip !== ifce.ip;
      const changedNetwork = changedIp || (mask !== undefined && mask !== ifce.mask);
      if (ip !== undefined) ifce.ip = ip;
      if (mask !== undefined) ifce.mask = mask;
      if (gw !== undefined) ifce.gw = gw;
      /* IP 变化后清 ARP（与真实系统一致） */
      if (changedNetwork || ip === '') {
        this.arpCaches?.get(ifName)?.clear();
        this.arpCaches?.delete(ifName);
      }
      NS.Bus.emit('device:changed', this.id);
      NS.Bus.emit('topology:touched');
      if (changedIp && ip && world.devices.get(this.id) === this) reportConflicts(ifce);
      return null;
    }

    addRoute(dest, mask, nh) {
      const IP = NS.IP;
      if (!IP.valid(dest) || !IP.validMask(mask) || !IP.validUnicast(nh)) return false;
      this.staticRoutes.push({ dest: IP.normalize(dest), mask: IP.normalize(mask), nh: IP.normalize(nh) });
      NS.Bus.emit('device:changed', this.id);
      NS.Bus.emit('topology:touched');
      return true;
    }
    removeRoute(i) {
      this.staticRoutes.splice(i, 1);
      NS.Bus.emit('device:changed', this.id);
      NS.Bus.emit('topology:touched');
    }

    /* 供 netstat / inspector 的连接视图 */
    tcpRows() {
      const P = Proto();
      const rows = [];
      if (this.type === 'switch') return rows;
      P.tcp.listenersOf(this).forEach((svc, port) => rows.push({ local: `0.0.0.0:${port}`, foreign: '[::]:0', state: 'LISTENING' }));
      P.tcp.connsOf(this).forEach(c => rows.push({
        local: `${c.localIp}:${c.localPort}`, foreign: `${c.remoteIp}:${c.remotePort}`, state: c.state,
      }));
      return rows;
    }

    toJSON() {
      const o = { id: this.id, type: this.type, name: this.name, x: Math.round(this.x), y: Math.round(this.y), on: this.on,
                  ifaces: this.interfaces.map(i => ({ name: i.name, mac: i.mac, ip: i.ip, mask: i.mask, gw: i.gw })) };
      if (this.type !== 'switch') o.staticRoutes = this.staticRoutes.map(r => ({ ...r }));
      if (this.type === 'server') o.services = { ...this.services };
      return o;
    }

    static fromJSON(o) {
      const type = o.type === 'router' ? 'router' : o.type === 'switch' ? 'switch' : o.type === 'server' ? 'server' : 'pc';
      /* 绕过自动命名/自动建接口：先按类型构造再覆盖 */
      const d = new Device(type, o.x ?? 100, o.y ?? 100);
      d.name = o.name || d.name;
      d.on = o.on !== false;
      d.id = o.id || d.id;
      if (o.ifaces && o.ifaces.length) d.interfaces = o.ifaces.map(i => {
        const ifce = new Interface(i.name || 'eth0');
        ifce.mac = i.mac?.toUpperCase() || ifce.mac;
        ifce.ip = NS.IP.normalize(i.ip); ifce.mask = NS.IP.normalize(i.mask); ifce.gw = NS.IP.normalize(i.gw);
        return ifce;
      });
      if (type !== 'switch') d.staticRoutes = (o.staticRoutes || []).map(({ dest, mask, nh }) => ({
        dest: NS.IP.normalize(dest), mask: NS.IP.normalize(mask), nh: NS.IP.normalize(nh),
      }));
      if (type === 'server') { d.services = { http: !!(o.services && o.services.http), telnet: !!(o.services && o.services.telnet) }; d.applyServices(); }
      return d;
    }
  }
  NS.Device = Device;
  NS.Link = Link;

  NS.createDevice = (type, x, y) => world.addDevice(new Device(type, x, y));
  NS.connectDevices = (a, b) => world.connect(a, b);

  /* ── 整体拓扑序列化 ── */
  NS.saveTopology = () => ({
    version: 1,
    savedAt: new Date().toISOString(),
    devices: [...world.devices.values()].map(d => d.toJSON()),
    links: [...world.links.values()].map(l => ({
      a: { dev: l.a.dev, if: l.a.ifName }, b: { dev: l.b.dev, if: l.b.ifName },
      delay: l.delay, loss: l.loss, up: l.up,
    })),
  });

  function validTopology(data) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const optionalString = value => value === undefined || typeof value === 'string';
    const optionalBool = value => value === undefined || typeof value === 'boolean';
    const optionalAddress = value => value === undefined || value === '' || NS.IP.validUnicast(value);
    const optionalMask = value => value === undefined || value === '' || NS.IP.validMask(value);
    if (!object(data) || (data.version !== undefined && data.version !== 1) || !Array.isArray(data.devices)) return false;
    if (data.links !== undefined && !Array.isArray(data.links)) return false;
    for (const d of data.devices) {
      if (!object(d) || !['pc', 'server', 'router', 'switch'].includes(d.type)) return false;
      if (!optionalString(d.id) || !optionalString(d.name) || !optionalBool(d.on)) return false;
      if ((d.x !== undefined && !Number.isFinite(d.x)) || (d.y !== undefined && !Number.isFinite(d.y))) return false;
      if (d.ifaces !== undefined && !Array.isArray(d.ifaces)) return false;
      const names = new Set();
      for (const i of (d.ifaces || [])) {
        if (!object(i) || typeof i.name !== 'string' || !i.name || names.has(i.name)) return false;
        names.add(i.name);
        if (i.mac !== undefined && (typeof i.mac !== 'string' || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(i.mac))) return false;
        if (!optionalAddress(i.ip) || !optionalMask(i.mask) || !optionalAddress(i.gw)) return false;
      }
      if (d.staticRoutes !== undefined && !Array.isArray(d.staticRoutes)) return false;
      for (const r of (d.staticRoutes || [])) {
        if (!object(r) || !NS.IP.valid(r.dest) || !NS.IP.validMask(r.mask) || !NS.IP.validUnicast(r.nh)) return false;
      }
      if (d.services !== undefined && (!object(d.services) || !optionalBool(d.services.http) || !optionalBool(d.services.telnet))) return false;
    }
    for (const link of (data.links || [])) {
      if (!object(link) || !object(link.a) || !object(link.b)) return false;
      if (![link.a.dev, link.a.if, link.b.dev, link.b.if].every(v => typeof v === 'string' && v.length > 0)) return false;
      if (link.delay !== undefined && (!Number.isFinite(link.delay) || link.delay < 1 || link.delay > 500)) return false;
      if (link.loss !== undefined && (!Number.isFinite(link.loss) || link.loss < 0 || link.loss > 100)) return false;
      if (!optionalBool(link.up)) return false;
    }
    return true;
  }

  NS.loadTopology = (data, { beforeReplace = conflicts => !conflicts.length } = {}) => {
    if (!validTopology(data)) return false;
    const previousCounters = counters;
    counters = { pc: 0, router: 0, switch: 0, server: 0, mac: 0, link: 0 };
    counters.importIds = new Set(data.devices.map(d => d.id));
    counters.importMacs = new Set(data.devices.flatMap(d => (d.ifaces || []).map(i => i.mac?.toUpperCase())));
    const devices = new Map(), links = new Map();
    try {
      data.devices.forEach(o => {
        const d = NS.Device.fromJSON(o);
        if (devices.has(d.id)) throw new Error('Duplicate device ID');
        devices.set(d.id, d);
      });
      (data.links || []).forEach(lo => {
        const dA = devices.get(lo.a.dev), dB = devices.get(lo.b.dev);
        if (!dA || !dB || dA === dB) throw new Error('Invalid link endpoints');
        const ifA = dA.getInterface(lo.a.if), ifB = dB.getInterface(lo.b.if);
        if (!ifA || !ifB || ifA.linkId || ifB.linkId) throw new Error('Invalid or occupied interface');
        const link = new Link(ifA, dA, ifB, dB);
        link.delay = lo.delay != null ? lo.delay : 4;
        link.loss = lo.loss || 0;
        link.up = lo.up !== false;
        ifA.linkId = link.id; ifB.linkId = link.id;
        links.set(link.id, link);
      });
    } catch (e) {
      counters = previousCounters;
      return false;
    }
    const importedCounters = counters;
    delete importedCounters.importMacs;
    delete importedCounters.importIds;
    counters = previousCounters;
    const conflicts = addressConflicts(devices, links);
    if (!beforeReplace(conflicts)) return false;
    world.clear();
    counters = importedCounters;
    devices.forEach(d => world.devices.set(d.id, d));
    links.forEach(l => world.links.set(l.id, l));
    NS.Bus.emit('world:changed');
    if (conflicts.length) NS.Bus.emit('address:conflict', conflicts);
    return true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
