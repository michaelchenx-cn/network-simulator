/* ═══════════════ sniffer.js — 抓包面板（类 Wireshark） ═══════════════
 * 订阅内核 'frame' 事件 → 报文列表 + 点击逐层解码（以太网 → IP → TCP/ICMP/ARP）。
 */
(function (root) {
  const NS = root.NS = root.NS || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const Sniffer = {
    rows: [],            // {no, t, linkId, linkName, fromDev, frame, len}
    sel: null,
    point: 'all',
    nextNo: 1,

    init() {
      NS.Bus.on('frame', (rec) => this.capture(rec));
      NS.Bus.on('world:cleared', () => this.clear());

      document.getElementById('sn-clear').addEventListener('click', () => this.clear());
      ['sn-arp', 'sn-icmp', 'sn-tcp'].forEach(id => document.getElementById(id).addEventListener('change', () => this.render()));
      document.getElementById('sn-point').addEventListener('change', (e) => { this.point = e.target.value; this.render(); });

      NS.Bus.on('world:changed', () => this.refreshPoints());
      NS.I18N.onChange(() => { this.refreshPoints(); this.render(); this.renderDetail(); });
      this.refreshPoints();
    },

    refreshPoints() {
      const sel = document.getElementById('sn-point');
      const cur = this.point;
      sel.innerHTML = `<option value="all">${NS.t('sn.all')}</option>` +
        [...NS.world.links.values()].map(l => `<option value="${l.id}">${esc(l.name())}</option>`).join('');
      this.point = [...NS.world.links.values()].some(l => l.id === cur) || cur === 'all' ? cur : 'all';
      sel.value = this.point;
    },

    protoOf(frame) {
      if (frame.eth.type === 'ARP') return 'ARP';
      const ip = frame.payload.ip;
      return ip.proto;
    },

    capture(rec) {
      this.rows.push({ ...rec, no: this.nextNo++ });
      if (this.rows.length > 1500) {
        const removed = this.rows.shift();
        document.querySelector(`#sniffer-table tr[data-no="${removed.no}"]`)?.remove();
        if (this.sel === removed.no) { this.sel = null; this.renderDetail(); }
      }
      if (this.matchFilter(rec)) this.appendRow(this.rows[this.rows.length - 1]);
      document.getElementById('sn-count').textContent = `${this.rows.length}`;
    },

    matchFilter(rec) {
      if (this.point !== 'all' && rec.linkId !== this.point) return false;
      const p = this.protoOf(rec.frame);
      const on = { ARP: 'sn-arp', ICMP: 'sn-icmp', TCP: 'sn-tcp' }[p];
      if (!on) return true;
      return document.getElementById(on).checked;
    },

    /* ── 信息列（仿 Wireshark，协议分析器输出保持英文） ── */
    infoOf(rec) {
      const f = rec.frame, p = f.payload;
      if (f.eth.type === 'ARP') {
        return p.op === 1 ? `Who has ${p.tpa}? Tell ${p.spa}` : `${p.spa} is at ${p.sha}`;
      }
      const ip = p.ip, l4 = p.payload;
      if (ip.proto === 'ICMP') {
        if (l4.type === 8) return `Echo (ping) request  id=0x${(l4.echoId).toString(16).padStart(4, '0')}, seq=${l4.seq}, ttl=${ip.ttl}`;
        if (l4.type === 0) return `Echo (ping) reply    id=0x${(l4.echoId).toString(16).padStart(4, '0')}, seq=${l4.seq}, ttl=${ip.ttl}`;
        if (l4.type === 11) return `Time-to-live exceeded (in transit, for ${l4.quote?.ip.dst || '?'})`;
        if (l4.type === 3) return `Destination unreachable (${l4.code === 1 ? 'host' : 'network'} unreachable)`;
        return `ICMP type=${l4.type}`;
      }
      if (ip.proto === 'TCP') {
        const fl = Object.keys(l4.flags).filter(k => l4.flags[k]).join(', ');
        const data = l4.data ? ` [${l4.data.slice(0, 24).replace(/\r/g, '\\r').replace(/\n/g, '\\n')}${l4.data.length > 24 ? '…' : ''}]` : '';
        return `${l4.sport} → ${l4.dport} [${fl}] Seq=${l4.seq} Ack=${l4.ack} Win=${l4.win} Len=${l4.dataLen}${data}`;
      }
      return '';
    },

    srcOf(rec) {
      const f = rec.frame;
      if (f.eth.type === 'ARP') return f.payload.sha;
      return f.payload.ip.src;
    },
    dstOf(rec) {
      const f = rec.frame;
      if (f.eth.type === 'ARP') return f.payload.op === 1 ? 'FF:FF:FF:FF:FF:FF' : f.payload.tha;
      return f.payload.ip.dst;
    },

    rowHtml(r) {
      const proto = this.protoOf(r.frame);
      return `<tr data-no="${r.no}">` +
        `<td>${r.no}</td><td>${(r.t / 1000).toFixed(3)}</td>` +
        `<td>${esc(this.srcOf(r))}</td><td>${esc(this.dstOf(r))}</td>` +
        `<td class="p-${proto}">${proto}</td><td>${r.len}</td><td>${esc(this.infoOf(r))}</td></tr>`;
    },

    appendRow(r) {
      if (!this.matchFilter(r)) return;
      const tb = document.querySelector('#sniffer-table tbody');
      tb.insertAdjacentHTML('beforeend', this.rowHtml(r, true));
      const wrap = document.getElementById('sniffer-table-wrap');
      if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 60) wrap.scrollTop = wrap.scrollHeight;
    },

    render() {
      const tb = document.querySelector('#sniffer-table tbody');
      tb.innerHTML = this.rows.map(r => this.matchFilter(r) ? this.rowHtml(r, true) : '').join('');
      if (this.sel) this.markSel();
    },

    markSel() {
      document.querySelectorAll('#sniffer-table tr').forEach(tr => tr.classList.toggle('sel', +tr.dataset.no === this.sel));
    },

    clear() {
      this.rows = []; this.sel = null; this.nextNo = 1;
      document.querySelector('#sniffer-table tbody').innerHTML = '';
      document.getElementById('sn-count').textContent = '0';
      this.renderDetail();
    },

    /* ── 逐层解码 ── */
    fields(rowsHtml) { return rowsHtml.map(([k, v]) => `<div class="dec-field"><b>${k}</b><span class="fv">${esc(v)}</span></div>`).join(''); }

    ,
    renderDetail() {
      const box = document.getElementById('sniffer-detail');
      const r = this.rows.find(x => x.no === this.sel);
      if (!r) {
        box.innerHTML = `<div class="muted">${NS.t('sn.detailHint')}</div>`;
        return;
      }
      const zh = NS.I18N.lang === 'zh';
      const f = r.frame;
      let html = `<div class="dec-tree">`;

      /* 以太网层 */
      const ethType = f.eth.type === 'ARP' ? 'ARP (0x0806)' : 'IPv4 (0x0800)';
      html += `<div class="dec-layer dec-eth"><h5>Ethernet II ${zh ? '以太网帧' : ''}, Src: ${esc(f.eth.src)}, Dst: ${esc(f.eth.dst)}</h5>` +
        this.fields([
          [zh ? '目的 MAC' : 'Destination', f.eth.dst + (f.eth.dst === 'FF:FF:FF:FF:FF:FF' ? (zh ? '（广播）' : ' (Broadcast)') : '')],
          [zh ? '源 MAC' : 'Source', f.eth.src],
          [zh ? '类型' : 'Type', ethType],
          [zh ? '帧长度' : 'Frame length', r.len + ' B'],
        ]) + `</div>`;

      if (f.eth.type === 'ARP') {
        const p = f.payload;
        html += `<div class="dec-layer dec-arp"><h5>Address Resolution Protocol ${zh ? '(地址解析协议)' : ''}</h5>` +
          this.fields([
            [zh ? '操作码' : 'Opcode', p.op === 1 ? (zh ? '1 (请求 request)' : '1 (request)') : (zh ? '2 (应答 reply)' : '2 (reply)')],
            [zh ? '发送方 MAC' : 'Sender MAC', p.sha],
            [zh ? '发送方 IP' : 'Sender IP', p.spa],
            [zh ? '目标 MAC' : 'Target MAC', p.tha],
            [zh ? '目标 IP' : 'Target IP', p.tpa],
          ]) + `</div>`;
      } else {
        const ip = f.payload.ip, l4 = f.payload.payload;
        html += `<div class="dec-layer dec-ip"><h5>Internet Protocol Version 4 ${zh ? '(IP 包)' : ''}, Src: ${esc(ip.src)}, Dst: ${esc(ip.dst)}</h5>` +
          this.fields([
            [zh ? '源 IP 地址' : 'Source Address', ip.src],
            [zh ? '目的 IP 地址' : 'Destination Address', ip.dst],
            ['TTL', ip.ttl + (zh ? '（每经过一台路由器减 1）' : ' (decremented by each router)')],
            ['Protocol', ip.proto],
            ['Identification', '0x' + (ip.id || 0).toString(16).padStart(4, '0')],
          ]) + `</div>`;
        if (ip.proto === 'ICMP') {
          const typeTxt = { 8: zh ? '8 (Echo 请求)' : '8 (Echo Request)', 0: zh ? '0 (Echo 应答)' : '0 (Echo Reply)', 11: zh ? '11 (超时)' : '11 (Time Exceeded)', 3: zh ? '3 (不可达)' : '3 (Unreachable)' }[l4.type] || l4.type;
          const fs = [['Type', typeTxt], ['Code', l4.code]];
          const quoted = l4.quote;
          if (quoted) fs.push([zh ? '原目的地址' : 'Original destination', quoted.ip.dst]);
          if (quoted?.ip.proto === 'TCP') {
            const { sport, dport, seq } = quoted.payload;
            fs.push([zh ? '原 TCP 段' : 'Original TCP segment', `${quoted.ip.src}:${sport} → ${quoted.ip.dst}:${dport}, Seq=${seq}`]);
          } else {
            const echo = quoted?.payload || l4;
            fs.push(['Identifier', '0x' + (echo.echoId || 0).toString(16).padStart(4, '0')], ['Sequence', echo.seq]);
          }
          fs.push([zh ? '数据长度' : 'Data length', (l4.dataLen || 0) + ' B']);
          html += `<div class="dec-layer dec-icmp"><h5>Internet Control Message Protocol ${zh ? '(ICMP 报文)' : ''}</h5>` + this.fields(fs) + `</div>`;
        }
        if (ip.proto === 'TCP') {
          const fl = Object.keys(l4.flags).filter(k => l4.flags[k]).join(', ');
          const fs = [
            [zh ? '源端口' : 'Source Port', l4.sport],
            [zh ? '目的端口' : 'Destination Port', l4.dport + (l4.dport === 80 ? ' (HTTP)' : l4.dport === 23 ? ' (Telnet)' : '')],
            ['Flags', '0x' + ((l4.flags.FIN) | (l4.flags.SYN << 1) | (l4.flags.RST << 2) | (l4.flags.PSH << 3) | (l4.flags.ACK << 4)).toString(16).padStart(2, '0') + ` [${fl}]`],
            ['Sequence Number', l4.seq],
            ['Acknowledgment Number', l4.ack],
            ['Window', l4.win],
            [zh ? '数据长度' : 'TCP payload', (l4.dataLen || 0) + ' B'],
          ];
          let tcpHtml = `<div class="dec-layer dec-tcp"><h5>Transmission Control Protocol ${zh ? '(TCP 段)' : ''}, ${l4.sport} → ${l4.dport}</h5>` + this.fields(fs);
          if (l4.data) tcpHtml += `<div class="dec-field" style="margin-top:4px;"><b>${zh ? '数据' : 'Data'}</b><span class="fv">${esc(l4.data.slice(0, 120))}${l4.data.length > 120 ? '…' : ''}</span></div>`;
          tcpHtml += `</div>`;
          html += tcpHtml;
        }
      }
      html += `</div>`;
      html += `<div style="margin-top:6px;color:#8a94a6;font-size:11px;">${NS.t('sn.onDev')} ${esc(r.linkName)}</div>`;
      box.innerHTML = html;
    },

    bind() {
      document.querySelector('#sniffer-table tbody').addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        this.sel = +tr.dataset.no;
        this.markSel();
        this.renderDetail();
      });
    },
  };
  NS.Sniffer = Sniffer;
})(typeof window !== 'undefined' ? window : globalThis);
