# 网络模拟器 · Network Simulator

一个面向计算机网络课堂教学的**纯网页版网络模拟器**（类 Cisco Packet Tracer）。
学生浏览器打开即用，零安装、零依赖、零构建；可双击 `index.html` 本地使用，也可整体上传任意静态托管/云端服务器分发。

## 功能特性

### 拓扑搭建
- 设备：**PC、服务器、路由器（最多 4 接口）、交换机（端口自动扩展）**
- 拖放放置、连线、缩放平移、删除；设备开关机；链路断开/恢复、传播时延与**丢包率**设置（故障注入）

### 真实协议仿真（可观察）
| 层 | 仿真内容 |
|---|---|
| 以太网 | 帧封装、MAC 寻址、广播 |
| ARP | 缓存查询 → 广播请求（交换机泛洪）→ 单播应答 → 缓存学习，`arp -a` 可查 |
| IPv4 | 最长前缀匹配（直连 + 静态路由）、本机 IP 与 127/8 回环通信、TTL 逐跳递减、跨网段转发时 MAC 重封装 / IP 端到端不变 |
| ICMP | Echo 请求/应答、超时（tracert 原理）、目标不可达（net/host unreachable） |
| TCP | 三次握手、四次挥手、TIME_WAIT(2MSL)、未确认报文重传、按序交付与重复数据去重、重传耗尽后关闭、RST（端口未监听） |

### 命令行终端（双击设备打开，仿 Windows 输出，中/英可切换）
```
ipconfig [/all]      查看 IP / 掩码 / 网关 / MAC（空接口显示未配置）
ping [-n N | -t | -i TTL] <IP>     连通性测试（先 ARP 后 ICMP，可观察）
tracert <IP>         逐跳跟踪，显示实测往返时间（* 超时，— 未发送）
arp -a | arp -d      按 IPv4 地址数值查看 / 清空 ARP 缓存
netstat [-an]        TCP 连接与状态（SYN_SENT / ESTABLISHED / TIME_WAIT …）
route print              查看路由表（PC、服务器、路由器）
route add <目标> [mask <掩码>] <下一跳>   添加静态路由，省略掩码时使用 /32
route delete <目标>      删除静态路由
telnet <IP> [端口]   建立 TCP 会话（观察握手 / 挥手 / 回显交互）
http <IP>            模拟浏览器：握手 → GET → 200 OK → 服务器挥手
show ip route / show arp / show mac     路由器 / 交换机视图
cls / help / Ctrl+C（中断正在运行的命令）
```

每个设备终端一次运行一个命令。运行中可按 Ctrl+C 中断，随后可输入新命令。Telnet 连接建立后输入的内容会发送给服务器。设备关机时会中断该终端上的命令。

Telnet 和 HTTP 会立即显示本机路由错误，或在收到路由器的 ICMP 错误时显示原因和重试状态。

### 可视化观察
- **数据包飞行动画**：按协议配色（黄=ARP、青=ICMP、绿=SYN、蓝=数据、橙=FIN、红=ICMP 错误/RST），广播可见泛洪
- **抓包面板**（类 Wireshark）：按链路捕获 + ARP/ICMP/TCP 过滤，点击报文**逐层解码**（以太网帧 → IP → TCP/ICMP/ARP 字段级展开，展示封装概念）
- **暂停 + 单步 + 0.1×~10× 倍速**：打开页面后自动运行。点击 ⏸ 暂停，再用 ⏭ 逐帧演示三次握手等过程
- **实时表**：交换机 MAC 地址表、设备 ARP 缓存、TCP 连接表。MAC 与 ARP 表项按仿真时间过期
- **事件日志**：内核级转发/丢包/重传记录

### 预置实验（工具栏【实验】）
1. **IP 配置与直连通** —— 配 IP 互 ping，观察 ARP 先行
2. **跨网段通信与静态路由** —— 补齐双端路由，tracert 看两跳
3. **ARP 解析与交换机 MAC 学习** —— 广播泛洪 → 学习 → 定向转发
4. **TCP 三次握手与四次挥手** —— telnet/http + netstat + 单步慢放 + TIME_WAIT
5. **网络故障排查** —— 预埋错误掩码 + 断链，命令行定位修复（含答案）

每个实验带双语任务书与**自动验收**按钮。一轮验证完成后才可再次点击，切换实验会取消正在运行的验证。

### 其他
- 中 / EN 一键切换，覆盖界面、实验指导、终端和事件日志
- 拓扑导出 / 导入 JSON，校验失败时保留当前画布和仿真状态，兼容已有版本 1 导出文件
- 导入、加载实验或清空前会确认是否替换当前拓扑。确认后终端关闭，仿真时间、抓包和日志清空。通过工具栏的 **恢复上一拓扑** 可以找回上一份拓扑配置，含设备、链路、IP 和路由
- 已有备份时，替换尚未修改的实验初始拓扑会保留原备份，方便连续切换实验后找回自建拓扑
- 拓扑及 IP、静态路由、服务开关、电源、链路参数修改后约 0.8 秒自动保存到当前浏览器
- 接口和静态路由的掩码可在属性面板选择 `/0` 至 `/32`，静态路由的 `/0` 标为默认路由
- 静态路由的下一跳可通过其他静态路由解析到直连出口。下一跳无法解析时，路由表会标明原因
- 同一二层网络中的重复 IP 或 MAC 会给出提示。导入含冲突的拓扑时可以取消，也可以确认继续以开展排障实验

## 快速开始

**方式一（免安装）**：直接双击 `index.html`。

**方式二（本地服务器）**：
```bash
cd "Network Simulator"
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

**方式三（云端部署）**：整个目录上传任意静态托管（Nginx / Apache / 对象存储静态网站 / 云开发静态托管等）即可，全部为相对路径引用，支持子目录部署。

> 提示：实验室电脑建议 Chrome / Edge 最新版。同一浏览器自动保留上次拓扑。

## 目录结构

```
index.html          页面骨架
css/style.css       全部样式
js/
  i18n.js           中英词典与切换
  engine.js         离散事件仿真内核（时钟/事件队列/事件总线）
  protocols.js      ARP / IPv4 / ICMP / TCP 协议栈与链路传输
  devices.js        设备模型、世界注册表、拓扑序列化
  commands.js       终端命令（仿 Windows 双语输出）
  terminal.js       终端组件
  canvas.js         SVG 拓扑画布与报文动画
  inspector.js      右侧属性/配置面板
  sniffer.js        抓包面板（列表 + 逐层解码）
  labs.js           预置实验
  app.js            启动装配
tests/run.js        引擎自动化测试（Node，无 DOM）
tests/browser.py    可选浏览器回归检查（Python Playwright）
```

## 自动化测试

```bash
node tests/run.js
```
覆盖：同网段 ping（ARP 先行）、关机超时、跨路由器（缺路由不可达 / 单边路由回程丢 / 双向通 + TTL 递减）、TTL=1 超时（tracert 原理）、TCP 握手三次序 / 挥手 / TIME_WAIT / RST 拒绝、错误掩码、断链恢复、交换机泛洪与学习。

回归检查还覆盖本机与回环通信、主机静态路由的保存恢复、最长前缀匹配、各跳抓包 TTL、导入失败保护、TCP 握手 ACK / 数据 / HTTP 响应 / 关闭 ACK 丢失、重复报文及同时关闭。丢包用确定性故障注入复现。

终端回归覆盖 `route add` 缺参数、TCP 的 ICMP 错误匹配与重试恢复，以及中断探测和 HTTP 请求。

浏览器检查使用独立临时浏览器会话，验证抓包显示与过滤、逐层解码、自动保存、导入文本安全、设备删除和实际终端操作。测试环境需安装 Python Playwright 和 Chromium。

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser.py
```

也可通过 `--browser-executable` 指定已安装的 Chrome/Chromium。macOS 示例命令如下。

```bash
python3 tests/browser.py --browser-executable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## 教学建议

- 演示三次握手：⏸ 暂停 → 输入 `telnet …` → 连按 ⏭ 单步，配合抓包面板逐层讲解
- 演示 ARP：把抓包点设在交换机某链路，观察广播泛洪与单播应答路径差异
- 排障教学：复制实验 5 拓扑，自行断链 / 改错掩码 / 删路由后让学生排查
- 丢包实验：链路设 30% 丢包，观察 ping 间歇超时与 TCP 重传（事件日志可见）
