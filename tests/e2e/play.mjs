// Drives a live match with keyboard/mouse to exercise building & editing.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const mode = process.argv[3] ?? 'freebuild';
const out = process.argv[4] ?? '/tmp/claude-0';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (!['debug'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.addInitScript(() => localStorage.setItem('robnite.save', JSON.stringify({ version: 1, profileCreated: true, profile: { displayName: 'Tester' }, login: { lastDay: 99999999, streak: 1 }, tutorial: { offered: true } })));
await page.goto(url);
await page.waitForSelector('.btn-play', { timeout: 30000 });
await page.evaluate((m) => window.robnite.startMatch(m, 'normal'), mode);
await page.waitForSelector('.click-to-play', { timeout: 90000 });
await page.click('.click-to-play');
await page.waitForTimeout(800);
const locked = await page.evaluate(() => !!document.pointerLockElement);
logs.push(`pointer locked: ${locked}`);
await page.screenshot({ path: `${out}/p0.png` });
// Look slightly down & build a wall
await page.mouse.move(640, 360);
await page.mouse.move(640, 560, { steps: 8 });
await page.keyboard.press('KeyZ');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/p1-ghost.png` });
await page.mouse.down();
await page.waitForTimeout(80);
await page.mouse.up();
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/p2-wall.png` });
const state = await page.evaluate(() => {
  const c = window.robnite.client;
  return { builds: c.match.builds.count, target: c.buildCtl.target && { key: c.buildCtl.target.key, valid: c.buildCtl.target.valid, reason: c.buildCtl.target.reason } };
});
logs.push(JSON.stringify(state));
// Ramp
await page.keyboard.press('KeyC');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/p3-rampghost.png` });
await page.mouse.down();
await page.waitForTimeout(50);
await page.mouse.up();
await page.waitForTimeout(400);
// Walk forward up the ramp
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${out}/p4-walk.png` });
logs.push(JSON.stringify(await page.evaluate(() => { const h = window.robnite.client.match.human; return { pos: [h.pos.x, h.pos.y, h.pos.z], builds: window.robnite.client.match.builds.count }; })));
console.log(logs.join('\n'));
await browser.close();
