// Quick screenshot helper for development: node tests/e2e/shot.mjs <url> <out.png> [waitMs] [script]
import { chromium } from 'playwright';
const [url, out, wait = '3000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
