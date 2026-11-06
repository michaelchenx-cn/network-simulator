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
            page.get_by_role('button', name='⏻ 关机', exact=True).click()
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
                 'ifaces': [{'name': marker, 'mac': '00:50:56:20:00:01', 'ip': '192.168.1.1', 'mask': '255.255.255.0'}]},
                {'id': 'review-pc', 'type': 'pc', 'name': marker, 'x': 100, 'y': 350,
                 'ifaces': [{'name': 'eth0', 'mac': '00:50:56:20:00:02', 'ip': '192.168.1.10', 'mask': '255.255.255.0'}]},
            ], 'links': []}
            import_file(page, fixture)
            page.wait_for_selector('.dev-node[data-id="review-router"]')
            page.locator('.dev-node[data-id="review-router"]').click()
            check(page.locator('#inspector-body img').count() == 0 and marker in page.locator('#inspector-body').inner_text(), '导入接口名称按文本显示')
            page.locator('.dev-node[data-id="review-pc"]').click()
            page.get_by_placeholder('192.168.1.10', exact=True).fill('192.168.1.11')
            page.get_by_placeholder('192.168.1.10', exact=True).press('Tab')
            check(page.locator('#toast-container img').count() == 0 and not page.evaluate('Boolean(window.__injected)'), '设备名称提示不会执行注入脚本')

            page.locator('.lab-load').nth(3).click()
            page.locator('.dev-node').filter(has_text='Server1').click()
            page.locator('#inspector-body input[type="checkbox"]').first.uncheck()
            page.wait_for_function("JSON.parse(localStorage.getItem('ns.topo')).devices.find(d => d.name === 'Server1')?.services.http === false")
            check(True, '服务器服务开关自动保存')
            page.locator('#inspector-body input[type="checkbox"]').first.check()
            page.locator('.dev-node').filter(has_text='PC1').dblclick()
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
