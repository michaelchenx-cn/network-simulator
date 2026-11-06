/* ═══════════════ engine.js — 离散事件仿真内核 ═══════════════
 * 仿真时钟以"仿真毫秒"计。所有协议行为（ARP 超时、ICMP 往返、TCP 重传…）
 * 均通过 schedule() 挂入事件队列，由 SimLoop 在浏览器中按倍速推进，
 * 在 Node 测试中可用 advanceUntilIdle() 快进。
 *
 * 该文件不依赖任何 DOM，可被 tests/run.js 直接加载。
 */
(function (root) {
  const NS = root.NS = root.NS || {};

  /* ── 事件总线 ── */
  const Bus = {
    _m: new Map(),
    on(topic, fn) {
      if (!this._m.has(topic)) this._m.set(topic, new Set());
      this._m.get(topic).add(fn);
      return () => this._m.get(topic) && this._m.get(topic).delete(fn);
    },
    emit(topic, ...args) {
      const s = this._m.get(topic);
      if (!s) return;
      [...s].forEach(fn => { try { fn(...args); } catch (e) { console.error('[bus]', topic, e); } });
    },
  };
  NS.Bus = Bus;

  /* ── 事件日志（内核视角） ── */
  const Logger = {
    entries: [],
    max: 1200,
    log(msg, level) {
      const e = { t: NS.Engine.time, level: level || 'info', msg };
      this.entries.push(e);
      if (this.entries.length > this.max) this.entries.shift();
      Bus.emit('log', e);
    },
    clear() { this.entries = []; Bus.emit('log:cleared'); },
  };
  NS.log = (m, l) => Logger.log(m, l);
  NS.Logger = Logger;

  /* ── 离散事件引擎 ── */
  const earlierEvent = (a, b) => a.t < b.t || (a.t === b.t && a.seq < b.seq);
  const Engine = {
    time: 0,        // 仿真时间（毫秒）
    speed: 1,
    running: false, // 由 SimLoop / UI 控制
    _heap: [],      // 小顶堆 {t, seq, fn, alive}
    _seq: 0,

    reset() { this.time = 0; this._heap = []; this._seq = 0; Bus.emit('sim:reset'); },

    /* 延迟 delayMs(仿真毫秒) 执行 fn；返回可取消句柄 */
    schedule(delayMs, fn, desc) {
      const h = { t: this.time + Math.max(0, delayMs), seq: ++this._seq, fn, alive: true, desc };
      const H = this._heap;
      H.push(h);
      let i = H.length - 1;
      while (i > 0) {                       // 上滤
        const p = (i - 1) >> 1;
        if (!earlierEvent(H[i], H[p])) break;
        [H[p], H[i]] = [H[i], H[p]]; i = p;
      }
      return h;
    },

    cancel(h) { if (h) h.alive = false; },

    _pop() {
      const H = this._heap;
      if (!H.length) return null;
      const top = H[0], last = H.pop();
      if (H.length) {
        H[0] = last;
        let i = 0;
        for (;;) {                          // 下滤
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < H.length && earlierEvent(H[l], H[m])) m = l;
          if (r < H.length && earlierEvent(H[r], H[m])) m = r;
          if (m === i) break;
          [H[m], H[i]] = [H[i], H[m]]; i = m;
        }
      }
      return top;
    },

    nextTime() { const h = this._heap[0]; return h ? h.t : null; },

    pending() { return this._heap.length; },

    /* 执行所有已到期事件 */
    process() {
      let guard = 0;
      while (this._heap.length && this._heap[0].t <= this.time && guard++ < 100000) {
        const e = this._pop();
        if (e.alive) { try { e.fn(); } catch (err) { console.error('[event]', e.desc, err); } }
      }
    },

    /* 单步：把时钟推进到下一个事件并执行它（用于逐帧教学演示） */
    stepEvent() {
      while (this._heap.length) {
        const e = this._pop();
        if (!e.alive) continue;
        if (e.t > this.time) this.time = e.t;
        try { e.fn(); } catch (err) { console.error('[step]', e.desc, err); }
        return true;
      }
      return false;
    },

    /* 快进：执行完队列中所有事件（含连锁新事件）。用于自动化测试与场景演算。
     * limitMs 限制相对当前时间最大推进；maxIter 限制事件总数，防死循环。 */
    advanceUntilIdle(limitMs = 120000, maxIter = 200000) {
      const t0 = this.time;
      let n = 0;
      while (this._heap.length && n < maxIter) {
        const top = this._heap[0];
        if (top.t - t0 > limitMs) break;
        const e = this._pop();
        if (!e.alive) continue;
        if (e.t > this.time) this.time = e.t;
        n++;
        try { e.fn(); } catch (err) { console.error('[fast]', e.desc, err); }
      }
      return n;
    },
  };
  NS.Engine = Engine;

  /* ── 实时驱动循环（仅浏览器；Node 下不启动） ── */
  const SimLoop = {
    _raf: null, _hb: null, _last: 0, _ticks: new Set(),

    /* 推进仿真时间并处理到期事件（rAF 与后台心跳共用；dtReal 有上限防跳变） */
    _beat(now) {
      const dtReal = Math.min(0.25, (now - this._last) / 1000);
      this._last = now;
      if (Engine.running) {
        Engine.time += dtReal * 1000 * Engine.speed;
        Engine.process();
      }
    },

    start() {
      if (typeof requestAnimationFrame === 'undefined') return; // Node 环境
      Engine.running = true;
      Bus.emit('sim:state', true);
      this._last = performance.now();
      const loop = (now) => {
        this._beat(now);
        this._ticks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
      /* 后台心跳：标签页不可见时 rAF 停转，用 interval 维持仿真时钟（浏览器限制约 1s 一次） */
      if (typeof setInterval === 'function' && !this._hb) {
        this._hb = setInterval(() => this._beat(performance.now()), 500);
      }
    },

    stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      if (this._hb) { clearInterval(this._hb); this._hb = null; }
      Engine.running = false;
    },

    play() { Engine.running = true; Bus.emit('sim:state', true); },
    pause() { Engine.running = false; Bus.emit('sim:state', false); },
    toggle() { Engine.running ? this.pause() : this.play(); },

    /* 单步：先暂停，再推进一个事件 */
    step() {
      this.pause();
      Engine.stepEvent();
    },

    setSpeed(s) { Engine.speed = Math.min(50, Math.max(0.05, s)); Bus.emit('sim:speed', Engine.speed); },

    onTick(fn) { this._ticks.add(fn); return () => this._ticks.delete(fn); },
  };
  NS.SimLoop = SimLoop;

  /* ── 小工具 ── */
  NS.fmtClock = (ms) => (ms / 1000).toFixed(1) + 's';
})(typeof window !== 'undefined' ? window : globalThis);
