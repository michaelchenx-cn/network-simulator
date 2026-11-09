/* ═══════════════ i18n.js — 中英双语机制 ═══════════════
 * 词典为扁平 key，每个 key 提供 zh / en 两种文案。
 * 其他模块可用 NS.I18N.register({...}) 合并注册自己的词条（如终端命令输出、实验文案）。
 * 语言持久化于 localStorage('ns.lang')，切换后重刷 DOM 并通知订阅者。
 */
(function (root) {
  const NS = root.NS = root.NS || {};

  const dict = {
    /* ── 应用 / 工具栏 ── */
    'app.title':            { zh: '网络模拟器', en: 'Network Simulator' },
    'tb.paletteTip':        { zh: '选择设备后单击画布放置', en: 'Pick a device, then click the canvas to place it' },
    'tb.select':            { zh: '选择/拖动模式', en: 'Select / drag mode' },
    'tb.selectLabel':       { zh: '选择', en: 'Select' },
    'tb.link':              { zh: '连线模式：依次点击两台设备', en: 'Link mode: click two devices in turn' },
    'tb.linkLabel':         { zh: '连线', en: 'Link' },
    'tb.delete':            { zh: '删除模式：点击设备或链路删除', en: 'Delete mode: click a device or link to remove' },
    'tb.deleteLabel':       { zh: '删除', en: 'Delete' },
    'tb.run':               { zh: '运行仿真', en: 'Run simulation' },
    'tb.pause':             { zh: '暂停仿真', en: 'Pause simulation' },
    'tb.step':              { zh: '单步（推进到下一个事件）', en: 'Single step (advance one event)' },
    'tb.speed':             { zh: '仿真倍速', en: 'Simulation speed' },
    'tb.zoomReset':         { zh: '重置视图', en: 'Reset view' },
    'tb.export':            { zh: '导出拓扑', en: 'Export' },
    'tb.import':            { zh: '导入拓扑', en: 'Import' },
    'tb.restore':           { zh: '恢复上一拓扑', en: 'Restore previous topology' },
    'tb.new':               { zh: '清空画布', en: 'Clear' },
    'tb.labs':              { zh: '实验', en: 'Labs' },
    'tb.theme':             { zh: '切换 明亮 / 暗色主题', en: 'Toggle light / dark theme' },
    'tb.help':              { zh: '帮助', en: 'Help' },

    /* ── 设备 ── */
    'dev.pc':      { zh: 'PC（学生电脑）', en: 'PC (student workstation)' },
    'dev.router':  { zh: '路由器', en: 'Router' },
    'dev.switch':  { zh: '交换机', en: 'Switch' },
    'dev.server':  { zh: '服务器', en: 'Server' },
    'dev.ifEth':   { zh: '以太网口', en: 'Ethernet port' },

    /* ── 画布 ── */
    'canvas.hint': { zh: '从上方工具栏选择设备，单击画布放置；双击设备打开终端；按住空白处拖动平移，滚轮缩放', en: 'Pick a device from the toolbar and click to place; double-click a device to open its terminal; drag empty space to pan, scroll to zoom' },
    'canvas.linkCut':   { zh: '链路已断开', en: 'Link down' },
    'canvas.linkUp':    { zh: '链路已恢复', en: 'Link restored' },

    /* ── 底部页签 ── */
    'bt.terminals': { zh: '终端', en: 'Terminals' },
    'bt.sniffer':   { zh: '抓包', en: 'Sniffer' },
    'bt.log':       { zh: '事件日志', en: 'Event Log' },
    'bt.closeAll':  { zh: '关闭全部终端', en: 'Close all terminals' },
    'bt.autoScroll':{ zh: '自动滚动', en: 'Auto-scroll' },

    /* ── 抓包面板 ── */
    'sn.capturePoint': { zh: '捕获点', en: 'Capture at' },
    'sn.all':      { zh: '所有链路', en: 'All links' },
    'sn.clear':    { zh: '清空', en: 'Clear' },
    'sn.time':     { zh: '时间', en: 'Time' },
    'sn.src':      { zh: '源地址', en: 'Source' },
    'sn.dst':      { zh: '目的地址', en: 'Destination' },
    'sn.proto':    { zh: '协议', en: 'Protocol' },
    'sn.len':      { zh: '长度', en: 'Len' },
    'sn.info':     { zh: '信息', en: 'Info' },
    'sn.detailHint': { zh: '点击上方报文列表中的条目，查看逐层解码（以太网帧 → IP → TCP / ICMP / ARP）', en: 'Click a frame in the list above to see layer-by-layer decoding (Ethernet → IP → TCP / ICMP / ARP)' },
    'sn.filter':   { zh: '过滤', en: 'Filter' },
    'sn.onDev':    { zh: '位于', en: 'on' },

    /* ── 属性面板 ── */
    'insp.noneTitle': { zh: '未选中任何对象', en: 'Nothing selected' },
    'insp.noneBody':  { zh: '单击画布中的设备或链路查看/修改配置；双击设备可打开命令行终端。', en: 'Click a device or link on the canvas to inspect & configure it. Double-click a device to open its terminal.' },
    'insp.name':      { zh: '名称', en: 'Name' },
    'insp.type':      { zh: '类型', en: 'Type' },
    'insp.power':     { zh: '电源', en: 'Power' },
    'insp.on':        { zh: '开机', en: 'On' },
    'insp.off':       { zh: '关机', en: 'Off' },
    'insp.delete':    { zh: '删除此设备', en: 'Delete device' },
    'insp.mac':       { zh: 'MAC 地址', en: 'MAC address' },
    'insp.ip':        { zh: 'IP 地址', en: 'IP address' },
    'insp.mask':      { zh: '子网掩码', en: 'Subnet mask' },
    'insp.gw':        { zh: '默认网关', en: 'Default gateway' },
    'insp.iface':     { zh: '接口', en: 'Interfaces' },
    'insp.addIf':     { zh: '＋ 添加接口', en: '＋ Add interface' },
    'insp.linkTo':    { zh: '连接到', en: 'links to' },
    'insp.notLinked': { zh: '未连接', en: 'not linked' },
    'insp.routes':    { zh: '静态路由', en: 'Static routes' },
    'insp.defaultRoute': { zh: '/0（默认路由）', en: '/0 (Default route)' },
    'insp.dest':      { zh: '目标网络', en: 'Destination' },
    'insp.nh':        { zh: '下一跳', en: 'Next hop' },
    'insp.addRoute':  { zh: '＋ 添加路由', en: '＋ Add route' },
    'insp.badRoute':  { zh: '目标网络 / 掩码 / 下一跳格式不正确', en: 'Invalid destination / mask / next-hop' },
    'insp.services':  { zh: '网络服务（监听端口）', en: 'Services (listening ports)' },
    'insp.http80':    { zh: 'HTTP 服务 (TCP 80)', en: 'HTTP server (TCP 80)' },
    'insp.telnet23':  { zh: 'Telnet 服务 (TCP 23)', en: 'Telnet server (TCP 23)' },
    'insp.macTable':  { zh: 'MAC 地址表（实时）', en: 'MAC address table (live)' },
    'insp.clearMac':  { zh: '清空 MAC 表', en: 'Clear table' },
    'insp.port':      { zh: '端口', en: 'Port' },
    'insp.conns':     { zh: 'TCP 连接表（实时）', en: 'TCP connections (live)' },
    'insp.arpCache':  { zh: 'ARP 缓存（实时）', en: 'ARP cache (live)' },
    'insp.local':     { zh: '本地地址', en: 'Local' },
    'insp.foreign':   { zh: '远程地址', en: 'Foreign' },
    'insp.state':     { zh: '状态', en: 'State' },
    'insp.empty':     { zh: '（空）', en: '(empty)' },
    'insp.link':      { zh: '链路', en: 'Link' },
    'insp.linkState': { zh: '链路状态', en: 'Link state' },
    'insp.up':        { zh: '连通', en: 'Up' },
    'insp.down':      { zh: '断开', en: 'Down' },
    'insp.delay':     { zh: '传播时延 (ms)', en: 'Delay (ms)' },
    'insp.loss':      { zh: '丢包率 (%)', en: 'Loss (%)' },
    'insp.deleteLink':{ zh: '删除此链路', en: 'Delete link' },
    'insp.badIp':     { zh: 'IP 地址格式不正确', en: 'Invalid IP address' },
    'insp.newIf':     { zh: '接口', en: 'Interface' },
    'insp.powerOn':   { zh: '⏻ 开机', en: '⏻ Power on' },
    'insp.powerOff':  { zh: '⏻ 关机', en: '⏻ Power off' },
    'insp.offWarn':   { zh: '设备已关机：不响应任何报文', en: 'Device is off: it will not respond to any packet' },

    /* ── Toast / 通用 ── */
    'toast.paused':   { zh: '仿真处于暂停状态：报文不会继续转发，点击 ▶ 继续', en: 'Simulation is paused: packets will not move until you press ▶' },
    'toast.cleared':  { zh: '画布已清空', en: 'Canvas cleared' },
    'toast.exported': { zh: '拓扑已导出', en: 'Topology exported' },
    'toast.imported': { zh: '拓扑已导入', en: 'Topology imported' },
    'toast.importErr':{ zh: '导入失败：文件格式不正确', en: 'Import failed: invalid file' },
    'toast.saved':    { zh: '已自动保存到浏览器', en: 'Auto-saved to browser storage' },
    'toast.labLoad':  { zh: '实验已加载', en: 'Lab loaded' },
    'toast.confirmNew': { zh: '确定清空当前拓扑？', en: 'Clear the current topology?' },
    'toast.confirmImport': { zh: '导入文件并替换当前拓扑？', en: 'Import the file and replace the current topology?' },
    'toast.confirmLab': { zh: '加载实验并替换当前拓扑？', en: 'Load the lab and replace the current topology?' },
    'toast.confirmRestore': { zh: '恢复上一份拓扑？', en: 'Restore the previous topology?' },
    'toast.replaceEffects': { zh: '当前拓扑配置将备份，终端会关闭，仿真时钟和运行记录会重置。', en: 'The current topology will be backed up. Terminals will close, and simulation time and history will reset.' },
    'toast.replaceKeepBackup': { zh: '已有拓扑备份将保留，终端会关闭，仿真时钟和运行记录会重置。', en: 'The existing backup will be kept. Terminals will close, and simulation time and history will reset.' },
    'toast.restored': { zh: '已恢复上一份拓扑', en: 'Previous topology restored' },
    'toast.restoreErr': { zh: '无法恢复上一份拓扑', en: 'Could not restore the previous topology' },
    'toast.addressConflict': { zh: '同一二层网络中存在重复地址', en: 'Duplicate addresses on the same Layer 2 network' },
    'toast.conflictContinue': { zh: '仍要载入此拓扑？', en: 'Load this topology anyway?' },
    'insp.inactiveRoute': { zh: '下一跳不可解析', en: 'Next hop cannot be resolved' },
    'insp.unconfigured': { zh: '未配置', en: 'Unconfigured' },
    'ui.close': { zh: '关闭', en: 'Close' },
    'toast.linkFirst':  { zh: '请先点击第一台设备，再点击第二台设备完成连线', en: 'Click the first device, then the second, to create a link' },
    'toast.linkDone':   { zh: '链路已创建', en: 'Link created' },
    'toast.linkDup':    { zh: '这两个接口之间已存在链路', en: 'These two interfaces are already linked' },
    'toast.noFreePort': { zh: '没有可用接口', en: 'No free interface/port' },
    'toast.badIp':      { zh: 'IP 地址格式不正确', en: 'Invalid IP address' },
    'toast.termClosed': { zh: '终端已关闭', en: 'Terminal closed' },
    'ui.confirm':     { zh: '确定', en: 'OK' },
    'ui.cancel':      { zh: '取消', en: 'Cancel' },
    'ui.langName':    { zh: '中文', en: 'English' },

    /* ── 事件日志 ── */
    'log.title': { zh: '事件日志（仿真内核）', en: 'Event log (simulation kernel)' },
    'log.clear': { zh: '清空日志', en: 'Clear log' },
    'log.cleared': { zh: '日志已清空', en: 'Log cleared' },

    /* ── 帮助 ── */
    'help.title': { zh: '使用帮助', en: 'Help' },
  };

  let lang = 'zh';
  try { lang = localStorage.getItem('ns.lang') === 'en' ? 'en' : 'zh'; } catch (e) {}

  const listeners = [];

  const I18N = {
    get lang() { return lang; },

    t(key) {
      const e = dict[key];
      if (!e) return key;
      return e[lang] !== undefined ? e[lang] : (e.zh || key);
    },

    register(entries) { Object.assign(dict, entries); },

    setLang(l) {
      if (l !== 'zh' && l !== 'en' || l === lang) return;
      lang = l;
      try { localStorage.setItem('ns.lang', l); } catch (e) {}
      I18N.apply();
      listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
    },

    toggle() { I18N.setLang(lang === 'zh' ? 'en' : 'zh'); },

    onChange(fn) { listeners.push(fn); },

    apply(rootEl) {
      (rootEl || document).querySelectorAll('[data-i18n]').forEach(el => {
        const v = I18N.t(el.getAttribute('data-i18n'));
        // 保留按钮内 <span> 以外纯文本节点的情形：直接整体替换（本项目按钮文案均为纯文本或首行文本）
        if (el.children.length && el.tagName !== 'BUTTON') el.innerHTML = v;
        else el.textContent = v;
      });
      (rootEl || document).querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = I18N.t(el.getAttribute('data-i18n-title'));
      });
    },
  };

  NS.I18N = I18N;
  NS.t = I18N.t;
})(typeof window !== 'undefined' ? window : globalThis);
