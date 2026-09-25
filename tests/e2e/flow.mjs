// Development walkthrough: creates a profile, visits lobby tabs and starts a mode.
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:5173/';
const mode = process.argv[3] ?? 'freebuild';
const outDir = process.argv[4] ?? '/tmp/claude-0';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForSelector('.onboarding input', { timeout: 20000 });
await page.fill('.onboarding input', 'Tester');
await page.click('.onboarding .btn-primary');
await page.waitForTimeout(1200);
// Dismiss daily / tutorial modals
for (let i = 0; i < 3; i++) {
  const b = await page.$('.modal .btn-ghost, .modal .btn-primary');
  if (!b) break;
  const ghost = await page.$('.modal .btn-ghost');
  await (ghost ?? b).click();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${outDir}/lobby.png` });
for (const tab of ['locker', 'battlepass', 'shop', 'quests', 'career', 'settings']) {
  await page.click(`.topnav-item[data-tab="${tab}"]`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/tab-${tab}.png` });
}
await page.click('.topnav-item[data-tab="play"]');
await page.waitForTimeout(300);
if (mode !== 'none') {
  await page.evaluate((m) => window.robnite.startMatch(m, 'normal'), mode);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/loading.png` });
  await page.waitForSelector('.click-to-play', { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.click('.click-to-play');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/match.png` });
}
console.log(logs.join('\n'));
await browser.close();
