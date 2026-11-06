"""可选的桌面浏览器回归检查，需要 Python Playwright。"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-executable', help='使用已安装的 Chrome/Chromium 可执行文件')
    parser.add_argument('--screenshot', help='将抓包界面截图保存到指定路径')
    args = parser.parse_args()
    checks = 0

    def check(condition, message):
        nonlocal checks
        assert condition, message
        checks += 1
        print(f'  ✓ {message}', flush=True)

    def import_file(page, data):
        page.locator('#file-import').set_input_files({
            'name': 'regression-topology.json', 'mimeType': 'application/json',
            'buffer': json.dumps(data).encode(),
        })

    def command(page, line):
        page.locator('.term-win.active input').fill(line)
        page.locator('.term-win.active input').press('Enter')

    with sync_playwright() as p:
        options = {'headless': True}
        if args.browser_executable:
            options['executable_path'] = args.browser_executable
        browser = p.chromium.launch(**options)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='zh-CN')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.goto((ROOT / 'index.html').as_uri())
            page.wait_for_load_state('networkidle')
            page.locator('.lab-load').nth(2).click()
            page.locator('.dev-node').filter(has_text='PC1').dblclick()
            command(page, 'ping -n 1 192.168.1.20')
            page.wait_for_function("document.querySelector('.term-output').textContent.includes('统计信息')")

            page.locator('#btn-run').click()
            terminal_input = page.locator('.term-win.active input')
            terminal_output = page.locator('.term-win.active .term-output')
            command(page, 'ping -t 192.168.1.20')
            page.keyboard.type('tracert 192.168.1.30')
            terminal_input.press('Enter')
            check(terminal_input.get_attribute('readonly') is not None and '通过最多' not in terminal_output.inner_text(),
                  '持续 ping 期间无法启动第二条命令')
            terminal_input.press('Control+c')
            interrupted_output = terminal_output.inner_text()
            page.evaluate('NS.Engine.advanceUntilIdle(5000)')
            check(terminal_input.get_attribute('readonly') is None and terminal_output.inner_text() == interrupted_output,
                  'Ctrl+C 释放输入，持续 ping 停止输出')

            command(page, 'ping -n 1 192.168.1.30')
            device_box = page.locator('.dev-node').filter(has_text='PC1').locator('.dev-icon-bg').bounding_box()
            x = device_box['x'] + device_box['width'] / 2
            y = device_box['y'] + device_box['height'] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + 15, y + 5)
            page.evaluate("""() => {
                while (![...NS.Canvas.flights.values()].some(f => f.frame.payload.payload?.type === 0) && NS.Engine.stepEvent()) {}
                NS.Canvas.renderFlights();
            }""")
            page.mouse.move(x + 40, y + 15)
            check(page.evaluate("""() => {
                const drag = NS.Canvas._drag;
                return drag?.node.isConnected && drag.node.getAttribute('transform') === `translate(${drag.dev.x},${drag.dev.y})`;
            }"""), '拖动中处理 ARP 和 ICMP 报文，设备节点仍跟随鼠标')
            page.mouse.up()
            check(page.locator('#g-packets').get_by_text('ICMP回', exact=True).count() > 0,
                  '中文模式显示 ICMP 应答标签')
            page.locator('#btn-lang').click()
            check(page.locator('#g-packets').get_by_text('REPLY', exact=True).count() > 0 and
                  page.locator('.dev-type-switch .dev-sub').text_content() == '3 ports linked',
                  '切到英文后刷新正在飞行的报文和交换机标签')
            page.locator('#btn-lang').click()
            page.evaluate('NS.Engine.advanceUntilIdle(500)')
            page.locator('#btn-run').click()
            page.locator('[data-tab="sniffer"]').click()
            rows = page.locator('#sniffer-table tbody tr')
            check(rows.count() > 0 and rows.count() == page.locator('#sniffer-table tbody tr:visible').count(), '抓包列表显示实际收到的报文')
            rows.first.click()
            check('Address Resolution Protocol' in page.locator('#sniffer-detail').inner_text(), '点击 ARP 行可逐层解码')
            page.locator('#sn-arp').uncheck()
            check(page.locator('#sniffer-table tbody tr:visible').count() > 0 and page.locator('#sniffer-table tbody .p-ARP').count() == 0, '协议过滤后显示 ICMP 并隐藏 ARP')
            page.locator('#sn-arp').check()
            if args.screenshot:
                page.screenshot(path=args.screenshot)

            buffer_ok = page.evaluate("""() => {
                const sample = NS.Sniffer.rows[0];
                for (let i = 0; i < 1505; i++) NS.Sniffer.capture({ ...sample, t: i });
                const ids = [...document.querySelectorAll('#sniffer-table tbody tr')].map(row => +row.dataset.no);
                return ids.length === 1500 && new Set(ids).size === 1500 &&
                    ids.every((id, i) => id === NS.Sniffer.rows[i].no) && NS.Sniffer.sel === null;
            }""")
            check(buffer_ok, '抓包缓存淘汰后行号稳定、详情选择和数据一致')

            page.locator('.dev-node').filter(has_text='PC1').click()
            before = page.evaluate("NS.Bus._m.get('device:changed').size")
            for _ in range(5):
                page.locator('.dev-node').filter(has_text='PC2').click()
                page.locator('.dev-node').filter(has_text='PC1').click()
            check(page.evaluate("NS.Bus._m.get('device:changed').size") == before, '反复选择设备不会累积事件监听')

            page.get_by_placeholder('192.168.1.10', exact=True).fill('192.168.1.99')
            page.get_by_placeholder('192.168.1.10', exact=True).press('Tab')
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).devices.find(d => d.name === 'PC1').ifaces[0].ip === '192.168.1.99'")
            check(True, '修改 IP 后在页面打开期间自动保存')
            page.locator('.link-hit').first.click()
            page.locator('#inspector-body input[type="number"]').nth(0).fill('25')
            page.locator('#inspector-body input[type="number"]').nth(1).fill('15')
            page.locator('#inspector-body input[type="number"]').nth(1).press('Tab')
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).links.some(l => l.delay === 25 && l.loss === 15)")
            check(True, '链路延迟和丢包率自动保存')
            page.locator('.dev-node').filter(has_text='PC1').click()
            page.locator('[data-tab="terminals"]').click()
            command(page, 'ping -t 192.168.1.20')
            page.get_by_role('button', name='⏻ 关机', exact=True).click()
            check(terminal_input.get_attribute('readonly') is None and '当前命令已中断' in terminal_output.inner_text(),
                  '设备关机立即中断持续 ping 并释放输入')
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).devices.find(d => d.name === 'PC1').on === false")
            check(True, '设备电源状态自动保存')
            page.get_by_role('button', name='删除此设备', exact=True).click()
            check(page.locator('.ttab').count() == 0 and page.evaluate('NS.Terminals.map.size') == 0, '删除设备同时关闭其终端')

            before_import = page.evaluate('JSON.stringify({ devices: NS.saveTopology().devices, links: NS.saveTopology().links })')
            import_file(page, {'devices': [{'type': 'pc', 'ifaces': {}}], 'links': []})
            page.wait_for_selector('.toast-err')
            after_import = page.evaluate('JSON.stringify({ devices: NS.saveTopology().devices, links: NS.saveTopology().links })')
            check(before_import == after_import, '文件导入报错后保留原画布')

            # 无害脚本标记用于验证导入文本不会被当作 HTML 执行。
            marker = '<img src="./missing-regression.png" onerror="window.__injected=true">'
            fixture = {'version': 1, 'devices': [
                {'id': 'review-router', 'type': 'router', 'name': 'ReviewRouter', 'x': 300, 'y': 200,
                 'ifaces': [{'name': marker, 'mac': '00:50:56:20:00:01', 'ip': '192.168.1.1', 'mask': '255.255.255.224'}]},
                {'id': 'review-pc', 'type': 'pc', 'name': marker, 'x': 100, 'y': 350,
                 'ifaces': [{'name': 'eth0', 'mac': '00:50:56:20:00:02', 'ip': '192.168.1.10', 'mask': '255.255.255.0'}]},
            ], 'links': []}
            import_file(page, fixture)
            page.wait_for_selector('.dev-node[data-id="review-router"]')
            page.locator('.dev-node[data-id="review-router"]').click()
            check(page.locator('#inspector-body img').count() == 0 and marker in page.locator('#inspector-body').inner_text(), '导入接口名称按文本显示')
            mask_select = page.get_by_role('combobox', name='子网掩码', exact=True).first
            router_ip = page.locator('#inspector-body .insp-table input').first
            router_ip.fill('192.168.1.2')
            router_ip.press('Tab')
            check(mask_select.input_value() == '255.255.255.224' and
                  page.evaluate("NS.world.devices.get('review-router').interfaces[0].mask") == '255.255.255.224',
                  '编辑路由器 IP 时保留导入的 /27 掩码')
            mask_select.select_option(label='/25')
            check(page.evaluate("NS.world.devices.get('review-router').interfaces[0].mask") == '255.255.255.128',
                  '属性面板可直接配置路由器 /25 掩码')
            zero_option = 'option[value="0.0.0.0"]'
            route_mask = page.get_by_role('combobox', name='子网掩码', exact=True).last
            check(route_mask.locator(zero_option).text_content() == '/0（默认路由）' and
                  mask_select.locator(zero_option).text_content() == '/0', '仅静态路由的 /0 显示默认路由提示')
            page.locator('#btn-lang').click()
            english_mask = page.get_by_role('combobox', name='Subnet mask', exact=True).last
            check(english_mask.locator(zero_option).text_content() == '/0 (Default route)', '默认路由提示随语言切换')
            page.locator('#btn-lang').click()
            page.locator('.dev-node[data-id="review-pc"]').click()
            page.get_by_placeholder('192.168.1.10', exact=True).fill('192.168.1.11')
            page.get_by_placeholder('192.168.1.10', exact=True).press('Tab')
            check(page.locator('#toast-container img').count() == 0 and not page.evaluate('Boolean(window.__injected)'), '设备名称提示不会执行注入脚本')

            page.locator('.lab-load').nth(1).click()
            page.locator('.dev-node').filter(has_text='PC1').dblclick()
            command(page, 'http 192.168.2.99')
            page.wait_for_function("document.querySelector('.term-output').textContent.includes('报告目标网络不可达')", timeout=4000)
            check('正在重试' in terminal_output.inner_text(), '实际终端在 TCP 重试期间显示路由器不可达信息')
            page.locator('[data-tab="sniffer"]').click()
            page.locator('#sniffer-table tbody tr').filter(has_text='Destination unreachable').first.click()
            check('原 TCP 段' in page.locator('#sniffer-detail').inner_text() and
                  '192.168.2.99:80' in page.locator('#sniffer-detail').inner_text(), '抓包可解码 ICMP 错误引用的 TCP 端口')

            verify = page.locator('#lab-verify')
            check(verify.evaluate("""button => {
                button.click();
                button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return button.disabled;
            }"""), '运行验证时禁用按钮并拦截重复触发')
            page.wait_for_function("!document.getElementById('lab-verify').disabled")
            check(page.locator('#lab-checks .lab-check').count() == 2, '快速触发两次验证只输出一轮结果')

            verify.evaluate("button => { button.click(); NS.SimLoop.pause(); }")
            page.wait_for_function("document.querySelectorAll('#lab-checks .lab-check').length === 2")
            old_pc = page.evaluate_handle("[...NS.world.devices.values()].find(d => d.name === 'PC1')")
            assert old_pc.evaluate('dev => dev.icmpCbs.size') == 1, '切换实验前应有一条待完成的验证探测'
            page.locator('.lab-load').nth(3).click()
            check(old_pc.evaluate('dev => dev.icmpCbs.size') == 0 and verify.is_enabled() and
                  page.locator('#lab-checks .lab-check').count() == 0, '切换实验取消旧探测并释放验证按钮')
            old_pc.dispose()
            page.locator('#btn-run').click()
            page.locator('.dev-node').filter(has_text='Server1').click()
            page.locator('#inspector-body input[type="checkbox"]').first.uncheck()
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).devices.find(d => d.name === 'Server1')?.services.http === false")
            check(True, '服务器服务开关自动保存')
            page.locator('#inspector-body input[type="checkbox"]').first.check()
            page.locator('.dev-node').filter(has_text='PC1').dblclick()
            command(page, 'http 192.168.2.99')
            check('本机没有到目标的路由' in terminal_output.inner_text() and terminal_input.get_attribute('readonly') is None,
                  '本机无路由立即报错，终端可继续接收命令')
            command(page, 'http 192.168.1.20')
            page.wait_for_function("document.querySelector('.term-output').textContent.includes('连接已关闭')", timeout=15000)
            check('200 OK' in page.locator('.term-output').inner_text(), '实际终端 HTTP 请求收到响应并完成关闭')
            command(page, 'route add 10.0.0.0 mask 255.0.0.0 192.168.1.20')
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).devices.find(d => d.name === 'PC1').staticRoutes.length === 1")
            page.reload()
            page.wait_for_load_state('networkidle')
            check(page.evaluate("[...NS.world.devices.values()].find(d => d.name === 'PC1').staticRoutes.length") == 1, '主机路由自动保存且刷新后恢复')

            page.on('dialog', lambda dialog: dialog.accept())
            page.locator('#btn-new').click()
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).devices.length === 0")
            check(page.evaluate('NS.world.devices.size') == 0, '清空画布后自动保存空拓扑')
            check(not errors, f'浏览器无脚本错误 {errors}')
            print(f'\n浏览器回归通过 {checks} 项', flush=True)
            context.close()
        finally:
            browser.close()


if __name__ == '__main__':
    main()
