/* ═══════════════ inspector.js — 右侧属性/配置面板 ═══════════════
 * 静态表单在选择变化时渲染；实时表（ARP/MAC/TCP）订阅事件节流刷新。
 */
(function (root) {
  const NS = root.NS = root.NS || {};
  const t = (k) => NS.t(k);
  const $ = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const body = () => document.getElementById('inspector-body');

  function section(title, ...children) {
    const s = document.createElement('div');
    s.className = 'insp-section';
    const h = document.createElement('h3'); h.textContent = title; s.appendChild(h);
    children.forEach(c => c && s.appendChild(c));
    return s;
  }
  function row(labelTxt, inputEl) {
    const r = document.createElement('div'); r.className = 'insp-row';
    const l = document.createElement('label'); l.textContent = labelTxt;
    r.append(l, inputEl); return r;
  }
  function inputEl(value, { readonly = false, placeholder = '', width = null } = {}) {
    const i = document.createElement('input');
    i.value = value == null ? '' : value;
    if (readonly) i.readOnly = true;
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  function maskSelect(current, { compact = false, allowEmpty = true } = {}) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', t('insp.mask'));
    if (allowEmpty) select.add(new Option('—', ''));
    const currentPrefix = current ? NS.IP.maskLen(current) : null;
    for (let prefix = 32; prefix >= 0; prefix--) {
      const mask = NS.IP.str(NS.IP.maskOf(prefix));
      select.add(new Option(compact ? `/${prefix}` : mask, prefix === currentPrefix ? current : mask));
    }
    select.value = current;
    return select;
  }
  function btn(txt, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'insp-btn ' + (cls || '');
    b.textContent = txt;
    b.addEventListener('click', onClick);
    return b;
  }
  function partnerName(dev, ifce) {
    if (!ifce.linkId) return t('insp.notLinked');
    const link = NS.world.links.get(ifce.linkId);
    if (!link) return t('insp.notLinked');
    const end = link.a.dev === dev.id ? link.b : link.a;
    const peer = NS.world.devices.get(end.dev);
    return `${peer ? peer.name : '?'} · ${end.ifName}`;
  }

  const Inspector = {
    _liveTimer: null,

    show(sel) { this._sel = sel; this.render(); },

    render() {
      const b = body();
      b.innerHTML = '';
      if (this._liveTimer) { clearInterval(this._liveTimer); this._liveTimer = null; }
      if (this._liveUnsub) { this._liveUnsub(); this._liveUnsub = null; }
      const sel = this._sel;
      if (!sel || !sel.type) {
        b.appendChild(section(t('insp.noneTitle'), (() => {
          const p = document.createElement('div'); p.className = 'lab-goal'; p.textContent = t('insp.noneBody'); return p;
        })()));
        return;
      }
      if (sel.type === 'device') this.renderDevice(b, NS.world.devices.get(sel.id));
      else if (sel.type === 'link') this.renderLink(b, NS.world.links.get(sel.id));
    },

    /* ══════ 设备 ══════ */
    renderDevice(b, dev) {
      if (!dev) return;

      /* 基本信息 */
      const nameIn = inputEl(dev.name);
      nameIn.addEventListener('change', () => {
        dev.name = nameIn.value.trim() || dev.name;
        NS.Terminals.rename(dev.id);
        NS.Bus.emit('world:changed');
        this.render();
      });
      const typeMap = { pc: 'PC', router: t('dev.router'), switch: t('dev.switch'), server: t('dev.server') };
      const powerBtn = btn(dev.on ? t('insp.powerOff') : t('insp.powerOn'), dev.on ? 'on-btn off' : 'on-btn', () => {
        dev.power(!dev.on); this.render();
      });
      const delBtn = btn(t('insp.delete'), 'danger', () => {
        NS.world.removeDevice(dev.id);
        NS.Canvas.select(null);
      });
      const s1 = section(t('insp.name'), row(t('insp.name'), nameIn), row(t('insp.type'), inputEl(typeMap[dev.type], { readonly: true })), row(t('insp.power'), powerBtn), row('', delBtn));
      if (!dev.on) {
        const w = document.createElement('div'); w.style.cssText = 'color:#b91c1c;font-size:12px;margin-top:4px;';
        w.textContent = '⚠ ' + t('insp.offWarn');
        s1.appendChild(w);
      }
      b.appendChild(s1);

      if (dev.type === 'pc' || dev.type === 'server') this.renderHostIfaces(b, dev);
      if (dev.type === 'server') this.renderServices(b, dev);
      if (dev.type === 'router') this.renderRouter(b, dev);
      if (dev.type === 'switch') this.renderSwitch(b, dev);

      if (dev.type !== 'switch') {
        const arpSec = section(t('insp.arpCache'));
        arpSec.dataset.live = 'arp';
        b.appendChild(arpSec);
        const connSec = section(t('insp.conns'));
        connSec.dataset.live = 'conns';
        b.appendChild(connSec);
        this.renderLive(dev);
        this._liveUnsub = NS.Bus.on('device:changed', (id) => { if (id === dev.id && this._sel && this._sel.type === 'device' && this._sel.id === id) this.renderLive(dev); });
      }
    },

    renderHostIfaces(b, dev) {
      dev.interfaces.forEach(ifce => {
        const macIn = inputEl(NS.macWin(ifce.mac), { readonly: true });
        const ipIn = inputEl(ifce.ip, { placeholder: '192.168.1.10' });
        const maskSel = maskSelect(ifce.mask);
        const gwIn = inputEl(ifce.gw, { placeholder: '192.168.1.1' });
        const apply = () => {
          const err = dev.setIfConfig(ifce.name, { ip: ipIn.value.trim(), mask: maskSel.value, gw: gwIn.value.trim() });
          if (err) { NS.toast && NS.toast(t('toast.badIp'), 'err'); ipIn.value = ifce.ip; maskSel.value = ifce.mask; gwIn.value = ifce.gw; }
          else NS.toast && NS.toast(dev.name + ' ' + ifce.name + ' OK', 'ok');
        };
        [ipIn, maskSel, gwIn].forEach(el => el.addEventListener('change', apply));
        b.appendChild(section(`${t('insp.iface')} · ${ifce.name} (${partnerName(dev, ifce)})`,
          row(t('insp.mac'), macIn), row(t('insp.ip'), ipIn), row(t('insp.mask'), maskSel), row(t('insp.gw'), gwIn)));
      });
    },

    renderServices(b, dev) {
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      const mk = (key, labelKey) => {
        const lab = document.createElement('label');
        lab.className = 'chk'; lab.style.cssText = 'display:flex;gap:6px;align-items:center;color:#374151;';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!dev.services[key];
        cb.addEventListener('change', () => { dev.services[key] = cb.checked; dev.applyServices(); });
        lab.append(cb, document.createTextNode(t(labelKey)));
        return lab;
      };
      box.append(mk('http', 'insp.http80'), mk('telnet', 'insp.telnet23'));
      b.appendChild(section(t('insp.services'), box));
    },

    renderRouter(b, dev) {
      /* 接口表 */
      const tbl = document.createElement('table');
      tbl.className = 'insp-table';
      tbl.innerHTML = `<tr><th>${t('insp.iface')}</th><th>IP</th><th>${t('insp.mask')}</th><th>${t('insp.link')}</th><th></th></tr>`;
      dev.interfaces.forEach(ifce => {
        const tr = document.createElement('tr');
        const ipIn = inputEl(ifce.ip, { placeholder: '未配置' }); ipIn.style.width = '92px'; ipIn.style.fontSize = '11px';
        const maskSel = maskSelect(ifce.mask, { compact: true }); maskSel.style.fontSize = '11px';
        const apply = () => {
          const err = dev.setIfConfig(ifce.name, { ip: ipIn.value.trim(), mask: maskSel.value });
          if (err) { NS.toast && NS.toast(t('toast.badIp'), 'err'); ipIn.value = ifce.ip; maskSel.value = ifce.mask; }
        };
        ipIn.addEventListener('change', apply); maskSel.addEventListener('change', apply);
        tr.innerHTML = `<td>${esc(ifce.name)}<br><span style="color:#8a94a6">${esc(NS.macWin(ifce.mac))}</span></td>`;
        const td2 = document.createElement('td'); td2.appendChild(ipIn);
        const td3 = document.createElement('td'); td3.appendChild(maskSel);
        const td4 = document.createElement('td'); td4.textContent = partnerName(dev, ifce);
        tr.append(td2, td3, td4);
        tbl.appendChild(tr);
      });
      b.appendChild(section(t('insp.iface'), tbl, btn(t('insp.addIf'), '', () => { dev.addRouterInterface(); this.render(); })));

      /* 静态路由 */
      const rt = document.createElement('table');
      rt.className = 'insp-table';
      rt.innerHTML = `<tr><th>${t('insp.dest')}</th><th>${t('insp.mask')}</th><th>${t('insp.nh')}</th><th></th></tr>`;
      (dev.staticRoutes || []).forEach((r, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(r.dest)}</td><td>${esc(r.mask)}</td><td>${esc(r.nh)}</td>`;
        const td = document.createElement('td');
        const x = document.createElement('span'); x.className = 'x-del'; x.textContent = '✕';
        x.addEventListener('click', () => { dev.removeRoute(i); this.render(); });
        td.appendChild(x); tr.appendChild(td);
        rt.appendChild(tr);
      });
      const dIn = inputEl('', { placeholder: '192.168.2.0', width: 90 }); dIn.style.fontSize = '11px';
      const mSel = maskSelect('255.255.255.0', { compact: true, allowEmpty: false }); mSel.style.fontSize = '11px';
      mSel.querySelector('option[value="0.0.0.0"]').textContent = t('insp.defaultRoute');
      const nIn = inputEl('', { placeholder: '10.0.0.2', width: 90 }); nIn.style.fontSize = '11px';
      const addBtn = btn(t('insp.addRoute'), '', () => {
        if (!dev.addRoute(dIn.value.trim(), mSel.value, nIn.value.trim())) NS.toast && NS.toast(t('insp.badRoute'), 'err');
        else { dIn.value = ''; nIn.value = ''; }
        this.render();
      });
      const addRow = document.createElement('div'); addRow.className = 'insp-row'; addRow.style.flexWrap = 'wrap';
      addRow.append(dIn, mSel, nIn, addBtn);
      b.appendChild(section(t('insp.routes'), rt, addRow));
    },

    renderSwitch(b, dev) {
      const box = document.createElement('div');
      const tblWrap = document.createElement('div');
      tblWrap.dataset.live = 'mac';
      box.appendChild(tblWrap);
      const clearBtn = btn(t('insp.clearMac'), '', () => { dev.macTable.clear(); NS.log(`${dev.name}: MAC 表已清空`); this.renderLive(dev); });
      b.appendChild(section(t('insp.macTable'), tblWrap, clearBtn));
      this.renderLive(dev);
      this._liveTimer = setInterval(() => {
        if (this._sel && this._sel.type === 'device' && this._sel.id === dev.id) this.renderLive(dev);
      }, 1000);
    },

    /* 实时表 */
    renderLive(dev) {
      const b = body();
      if (dev.type === 'switch') {
        const w = b.querySelector('[data-live="mac"]');
        if (!w) return;
        const rows = [...dev.macTable.entries()];
        w.innerHTML = rows.length ? `<table class="insp-table"><tr><th>MAC</th><th>${t('insp.port')}</th><th>age(s)</th></tr>` +
          rows.map(([mac, e]) => `<tr><td>${esc(NS.macWin(mac))}</td><td>${esc(e.port)}</td><td class="mac-age">${((NS.Engine.time - e.t) / 1000).toFixed(0)}</td></tr>`).join('') + '</table>'
          : `<div class="insp-empty">${t('insp.empty')}</div>`;
        return;
      }
      const arpW = b.querySelector('[data-live="arp"]');
      if (arpW) {
        let html = '';
        dev.interfaces.forEach(ifce => {
          const cache = dev.arpCaches && dev.arpCaches.get(ifce.name);
          if (!cache || !cache.size) return;
          html += `<div style="font-size:11px;color:#6b7686;margin:4px 0 2px;">${esc(ifce.name)}</div><table class="insp-table"><tr><th>IP</th><th>MAC</th></tr>`;
          [...cache.entries()].forEach(([ip, e]) => { html += `<tr><td>${esc(ip)}</td><td>${esc(NS.macWin(e.mac))}</td></tr>`; });
          html += '</table>';
        });
        arpW.innerHTML = html || `<div class="insp-empty">${t('insp.empty')}</div>`;
      }
      const connW = b.querySelector('[data-live="conns"]');
      if (connW) {
        const rows = dev.tcpRows();
        connW.innerHTML = rows.length
          ? `<table class="insp-table"><tr><th>${t('insp.local')}</th><th>${t('insp.foreign')}</th><th>${t('insp.state')}</th></tr>` +
            rows.map(r => `<tr><td>${esc(r.local)}</td><td>${esc(r.foreign)}</td><td class="conn-state-${r.state}">${r.state}</td></tr>`).join('') + '</table>'
          : `<div class="insp-empty">${t('insp.empty')}</div>`;
      }
    },

    /* ══════ 链路 ══════ */
    renderLink(b, link) {
      if (!link) return;
      const [e1, e2] = link.endpoints();
      const endRow = (label, e) => {
        const i = inputEl(`${e.dev ? e.dev.name : '?'} · ${e.ifce ? e.ifce.name : '?'} ${e.ifce && e.ifce.ip ? '(' + e.ifce.ip + ')' : ''}`, { readonly: true });
        return row(label, i);
      };
      const upBtn = btn(link.up ? t('insp.up') + ' ✓' : t('insp.down'), link.up ? 'on-btn' : 'on-btn off', () => {
        link.up = !link.up;
        NS.log(`${link.name()}: ${link.up ? '链路恢复' : '链路断开'}`, link.up ? 'ok' : 'warn');
        NS.Bus.emit('world:changed');
        this.render();
      });
      const dIn = inputEl(link.delay, { readonly: false }); dIn.type = 'number'; dIn.min = 1; dIn.max = 500;
      dIn.addEventListener('change', () => {
        link.delay = Math.max(1, Math.min(500, +dIn.value || 4)); dIn.value = link.delay;
        NS.Bus.emit('topology:touched');
      });
      const lIn = inputEl(link.loss, { readonly: false }); lIn.type = 'number'; lIn.min = 0; lIn.max = 100;
      lIn.addEventListener('change', () => {
        link.loss = Math.max(0, Math.min(100, +lIn.value || 0)); lIn.value = link.loss;
        NS.Bus.emit('topology:touched');
      });
      const delBtn = btn(t('insp.deleteLink'), 'danger', () => { NS.world.removeLink(link.id); NS.Canvas.select(null); });

      b.appendChild(section(t('insp.link'), endRow('A', e1), endRow('B', e2), row(t('insp.linkState'), upBtn), row(t('insp.delay'), dIn), row(t('insp.loss'), lIn), row('', delBtn)));
    },
  };
  NS.Inspector = Inspector;

  /* 语言切换时重渲染 */
  document.addEventListener('DOMContentLoaded', () => {
    NS.I18N.onChange(() => Inspector.render());
  });
})(typeof window !== 'undefined' ? window : globalThis);
