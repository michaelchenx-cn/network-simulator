/* ═══════════════ canvas.js — SVG 拓扑画布 ═══════════════
 * 职责：设备/链路绘制与编辑（放置/拖动/连线/删除/选中）、
 *       视图缩放平移、报文飞行动画（按仿真时钟逐帧渲染）。
 */
(function (root) {
  const NS = root.NS = root.NS || {};

  const svg = () => document.getElementById('canvas');
  const gLinks = () => document.getElementById('g-links');
  const gPkts = () => document.getElementById('g-packets');
  const gDevs = () => document.getElementById('g-devices');

  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  /* 报文配色与标签 */
  function pktStyle(frame) {
    const p = frame.payload;
    if (frame.eth.type === 'ARP') return { color: p.op === 1 ? '#d97706' : '#f59e0b', label: 'ARP' };
    const l4 = p.payload;
    if (p.ip.proto === 'ICMP') {
      if (l4.type === 8) return { color: '#0d9488', label: 'ICMP' };
      if (l4.type === 0) return { color: '#14b8a6', label: 'ICMP回' };
      return { color: '#dc2626', label: 'ICMP错' };
    }
    if (p.ip.proto === 'TCP') {
      const f = l4.flags;
      if (f.RST) return { color: '#dc2626', label: 'RST' };
      if (f.SYN && f.ACK) return { color: '#4ade80', label: 'SYN·ACK' };
      if (f.SYN) return { color: '#22c55e', label: 'SYN' };
      if (f.FIN) return { color: '#f97316', label: 'FIN' };
      if (f.PSH) return { color: '#3b82f6', label: 'DATA' };
      return { color: '#94a3b8', label: 'ACK' };
    }
    return { color: '#64748b', label: '?' };
  }

  const ART = {
    pc: '<rect x="-13" y="-12" width="26" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M-4 5h8M0 5v4M-6 9h12" stroke="currentColor" stroke-width="1.8"/>',
    server: '<rect x="-12" y="-14" width="24" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="-12" y="1" width="24" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="-7" cy="-8.5" r="1.4" fill="currentColor"/><circle cx="-7" cy="6.5" r="1.4" fill="currentColor"/>',
    router: '<rect x="-15" y="-9" width="30" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M-9 -3h5m2 0h5m2 0h4M-9 3h5m2 0h5m2 0h4" stroke="currentColor" stroke-width="1.8"/>',
    switch: '<rect x="-15" y="-7" width="30" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M-9 0h4m3 0h4m3 0h4" stroke="currentColor" stroke-width="1.8"/>',
  };

  const Canvas = {
    mode: 'select',            // select | link | delete
    placeType: null,           // pc | router | switch | server
    linkFrom: null,            // 连线模式第一台设备
    selection: null,           // {type:'device'|'link', id}
    view: { x: 0, y: 0, k: 1 },
    flights: new Map(),        // id → flight 记录

    /* ───── 初始化 ───── */
    init() {
      const s = svg();
      /* 包一层世界坐标组 */
      const gWorld = el('g', { id: 'g-world' });
      const bg = document.getElementById('canvas-bg');
      s.insertBefore(gWorld, bg.nextSibling);
      [gLinks(), gPkts(), gDevs()].forEach(g => gWorld.appendChild(g));

      s.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      window.addEventListener('pointermove', (e) => this.onPointerMove(e));
      window.addEventListener('pointerup', (e) => this.onPointerUp(e));
      s.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      s.addEventListener('dblclick', (e) => this.onDblClick(e));
      window.addEventListener('keydown', (e) => this.onKey(e));

      NS.Bus.on('world:changed', () => this.redraw());
      NS.Bus.on('world:cleared', () => { this.flights.clear(); gPkts().innerHTML = ''; this.redraw(); });
      NS.Bus.on('device:changed', () => this.redraw());
      NS.Bus.on('flight', (f) => this.flights.set(f.id, f));
      NS.Bus.on('flight:end', (id) => this.flights.delete(id));
      NS.Bus.on('link:duplicate', () => NS.toast && NS.toast(NS.t('toast.linkDup'), 'warn'));
      NS.Bus.on('link:fail', () => NS.toast && NS.toast(NS.t('toast.noFreePort'), 'warn'));
      NS.SimLoop.onTick(() => this.renderFlights());

      this.applyView();
      this.redraw();
    },

    /* ───── 坐标换算 ───── */
    toWorld(e) {
      const r = svg().getBoundingClientRect();
      const { x, y, k } = this.view;
      return { x: (e.clientX - r.left - x) / k, y: (e.clientY - r.top - y) / k };
    },
    applyView() {
      const g = document.getElementById('g-world');
      if (g) g.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
    },
    zoomAt(factor, cx, cy) {
      const k2 = Math.min(2.5, Math.max(0.3, this.view.k * factor));
      this.view.x = cx - (cx - this.view.x) * k2 / this.view.k;
      this.view.y = cy - (cy - this.view.y) * k2 / this.view.k;
      this.view.k = k2;
      this.applyView();
    },

    /* ───── 模式 ───── */
    setMode(m) {
      this.mode = m; this.placeType = null; this.linkFrom = null;
      const s = svg();
      s.classList.toggle('mode-link', m === 'link');
      s.classList.toggle('mode-delete', m === 'delete');
      s.classList.remove('placing');
      document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('placing'));
      document.getElementById('btn-select').classList.toggle('active', m === 'select');
      document.getElementById('btn-link').classList.toggle('active', m === 'link');
      document.getElementById('btn-delete').classList.toggle('active', m === 'delete');
      this.redraw();
    },
    setPlace(type) {
      this.placeType = type; this.mode = 'select'; this.linkFrom = null;
      const s = svg();
      s.classList.add('placing');
      s.classList.remove('mode-link', 'mode-delete');
      document.querySelectorAll('.pal-btn').forEach(b => b.classList.toggle('placing', b.dataset.place === type));
      ['btn-select', 'btn-link', 'btn-delete'].forEach(id => document.getElementById(id).classList.remove('active'));
    },

    select(sel) {
      this.selection = sel;
      NS.Inspector.show(sel);
      this.redraw();
    },

    /* ───── 交互 ───── */
    _drag: null,
    onPointerDown(e) {
      if (e.target.closest('#canvas-zoom')) return;
      const devHit = e.target.closest('.dev-node');
      const linkHit = e.target.closest('.link-hit');

      if (this.placeType) {                          /* 放置设备 */
        const p = this.toWorld(e);
        const d = NS.createDevice(this.placeType, p.x, p.y);
        NS.log(`放置设备 ${d.name}`, 'ok');
        this.setMode('select');
        this.select({ type: 'device', id: d.id });
        return;
      }
      if (this.mode === 'delete') {
        if (devHit) { const d = NS.world.devices.get(devHit.dataset.id); if (d) { NS.world.removeDevice(devHit.dataset.id); this.select(null); } }
        else if (linkHit) { NS.world.removeLink(linkHit.dataset.id); this.select(null); }
        return;
      }
      if (this.mode === 'link' && devHit) {
        const d = NS.world.devices.get(devHit.dataset.id);
        if (!this.linkFrom) { this.linkFrom = d; this.redraw(); }
        else if (this.linkFrom === d) { this.linkFrom = null; this.redraw(); }
        else {
          const l = NS.world.connect(this.linkFrom, d);
          if (l) { NS.toast && NS.toast(NS.t('toast.linkDone'), 'ok'); this.select({ type: 'link', id: l.id }); }
          this.linkFrom = null;
        }
        return;
      }
      if (this.mode === 'select') {
        if (devHit) {
          const d = NS.world.devices.get(devHit.dataset.id);
          /* 手动双击检测：单击选中会重建设备 DOM，原生 dblclick 的 target
           * 会因节点被替换而失效（落在祖先上），因此不能依赖 dblclick 事件。 */
          const now = performance.now();
          if (this._lastDevClick && this._lastDevClick.id === d.id && now - this._lastDevClick.t < 500) {
            this._lastDevClick = null;
            NS.Terminals.open(d.id);
            if (NS.App) NS.App.showTab('terminals');
            return;
          }
          this._lastDevClick = { id: d.id, t: now };
          this._drag = { dev: d, startX: e.clientX, startY: e.clientY, origX: d.x, origY: d.y, moved: false, node: devHit };
          devHit.classList.add('dragging');
          return;
        }
        this._lastDevClick = null;
        if (linkHit) { this.select({ type: 'link', id: linkHit.dataset.id }); return; }
        /* 空白处：平移 */
        this._pan = { startX: e.clientX, startY: e.clientY, vx: this.view.x, vy: this.view.y };
        svg().classList.add('panning');
      }
    },
    onPointerMove(e) {
      if (this._drag) {
        const { k } = this.view;
        const dx = (e.clientX - this._drag.startX) / k, dy = (e.clientY - this._drag.startY) / k;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._drag.moved = true;
        this._drag.dev.x = this._drag.origX + dx;
        this._drag.dev.y = this._drag.origY + dy;
        const n = this._drag.node;
        n.setAttribute('transform', `translate(${this._drag.dev.x},${this._drag.dev.y})`);
        this.redrawLinksOnly();
      } else if (this._pan) {
        this.view.x = this._pan.vx + (e.clientX - this._pan.startX);
        this.view.y = this._pan.vy + (e.clientY - this._pan.startY);
        this.applyView();
      }
    },
    onPointerUp(e) {
      if (this._drag) {
        const { dev, moved } = this._drag;
        this._drag.node.classList.remove('dragging');
        this._drag = null;
        if (!moved) this.select({ type: 'device', id: dev.id });     /* 点击 = 选中 */
        else NS.Bus.emit('topology:touched');
      }
      if (this._pan) { this._pan = null; svg().classList.remove('panning'); }
    },
    onDblClick(e) {
      /* 双击设备开终端由 onPointerDown 的手动检测处理（DOM 重建会使原生 dblclick 失效）。
       * 这里只处理双击空白背景 → 重置视图。双重防护：
       * 1) 光标下方若还有设备节点则忽略（dblclick 可能因节点重建落在祖先上）；
       * 2) target 必须是背景本身。 */
      const hitEl = document.elementFromPoint(e.clientX, e.clientY);
      if (hitEl && hitEl.closest && hitEl.closest('.dev-node')) return;
      const t = e.target;
      if (t.id === 'canvas-bg' || t.id === 'canvas' || t.id === 'g-world' || t.tagName === 'svg') {
        this.view = { x: 0, y: 0, k: 1 };
        this.applyView();
      }
    },
    onWheel(e) {
      e.preventDefault();
      const r = svg().getBoundingClientRect();
      if (e.shiftKey) { this.view.x -= e.deltaY; this.applyView(); return; }
      this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    },
    onKey(e) {
      if (e.key === 'Escape') {
        if (this.placeType || this.mode !== 'select') { this.setMode('select'); return; }
        if (this.linkFrom) { this.linkFrom = null; this.redraw(); return; }
        this.select(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection && !e.target.closest('input,select,textarea,.term-win')) {
        if (this.selection.type === 'device') NS.world.removeDevice(this.selection.id);
        else NS.world.removeLink(this.selection.id);
        this.select(null);
      }
    },

    /* ───── 绘制 ───── */
    redraw() {
      if (!document.getElementById('g-world')) return;
      this.redrawLinksOnly();
      const gd = gDevs();
      gd.innerHTML = '';
      [...NS.world.devices.values()].forEach(d => gd.appendChild(this.drawDevice(d)));
    },

    redrawLinksOnly() {
      const gl = gLinks();
      gl.innerHTML = '';
      for (const link of NS.world.links.values()) {
        const [e1, e2] = link.endpoints();
        if (!e1.dev || !e2.dev) continue;
        const sel = this.selection && this.selection.type === 'link' && this.selection.id === link.id;
        const line = el('line', {
          x1: e1.dev.x, y1: e1.dev.y, x2: e2.dev.x, y2: e2.dev.y,
          class: 'link-line' + (sel ? ' selected' : '') + (link.up ? '' : ' down'),
        });
        gl.appendChild(line);
        const hit = el('line', {
          x1: e1.dev.x, y1: e1.dev.y, x2: e2.dev.x, y2: e2.dev.y,
          class: 'link-hit', stroke: 'transparent', 'stroke-width': 14,
        });
        hit.dataset.id = link.id;
        hit.style.pointerEvents = 'stroke';
        gl.appendChild(hit);
      }
    },

    drawDevice(d) {
      const g = el('g', { class: `dev-node dev-type-${d.type}`, transform: `translate(${d.x},${d.y})` });
      g.dataset.id = d.id;
      if (this.selection && this.selection.type === 'device' && this.selection.id === d.id) g.classList.add('selected');
      if (this.linkFrom === d) g.classList.add('selected');

      const icon = el('g', { class: 'dev-art' });
      icon.innerHTML = ART[d.type];
      g.append(
        el('rect', { class: 'dev-icon-bg', x: -24, y: -24, width: 48, height: 48, rx: 10 }),
        icon,
      );
      if (!d.on) {
        g.append(el('circle', { class: 'dev-off-badge', cx: 17, cy: -17, r: 8 }),
                 (() => { const x = el('text', { class: 'dev-off-x', x: 17, y: -16.5 }); x.textContent = '✕'; return x; })());
      }
      const name = el('text', { class: 'dev-name', y: 36 }); name.textContent = d.name;
      const sub = el('text', { class: 'dev-sub', y: 50 });
      if (d.type === 'pc' || d.type === 'server') sub.textContent = d.interfaces[0].ip || NS.t('canvas.unconfigured');
      else if (d.type === 'router') sub.textContent = d.interfaces.filter(i => i.ip).map(i => i.ip).join(' · ') || NS.t('canvas.unconfigured');
      else sub.textContent = d.interfaces.filter(i => i.linkId).length + ' 口' + NS.t('canvas.linked');
      g.append(name, sub);

      const hit = el('rect', { class: 'dev-hitbox', x: -26, y: -26, width: 52, height: 78, fill: 'transparent' });
      g.appendChild(hit);
      return g;
    },

    /* 报文飞行（每帧） */
    renderFlights() {
      const gp = gPkts();
      const now = NS.Engine.time;
      const keep = new Set();
      for (const f of this.flights.values()) {
        const link = NS.world.links.get(f.linkId);
        if (!link) { this.flights.delete(f.id); continue; }
        const [e1, e2] = link.endpoints();
        if (!e1.dev || !e2.dev) continue;
        const fromA = f.from === e1.dev.id;
        const p1 = fromA ? e1.dev : e2.dev, p2 = fromA ? e2.dev : e1.dev;
        const prog = Math.min(1, Math.max(0, (now - f.t0) / Math.max(0.001, f.t1 - f.t0)));
        /* 垂直偏移，避免同链路多包重叠 */
        const off = ((f.id % 5) - 2) * 7;
        const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * off, ny = dx / len * off;
        const x = p1.x + dx * prog + nx, y = p1.y + dy * prog + ny;

        let node = gp.querySelector(`[data-fid="${f.id}"]`);
        if (!node) {
          const st = pktStyle(f.frame);
          node = el('g', { class: 'pkt-g', 'data-fid': f.id });
          node.append(
            el('rect', { class: 'pkt-body', x: -17, y: -8, width: 34, height: 16, rx: 4, fill: st.color }),
          );
          const tx = el('text', { class: 'pkt-text', y: 0.5 });
          tx.textContent = st.label;
          node.appendChild(tx);
          gp.appendChild(node);
        }
        node.setAttribute('transform', `translate(${x},${y})`);
        keep.add(f.id);
      }
      /* 清理已结束的节点 */
      [...gp.children].forEach(n => { if (!keep.has(+n.dataset.fid)) n.remove(); });
    },
  };

  NS.Canvas = Canvas;
  NS.I18N.register({
    'canvas.unconfigured': { zh: '未配置', en: 'unconfigured' },
    'canvas.linked': { zh: '连接', en: ' linked' },
  });
})(typeof window !== 'undefined' ? window : globalThis);
