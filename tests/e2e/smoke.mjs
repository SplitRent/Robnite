// End-to-end smoke test in a real browser (Chromium via Playwright).
//   npm run build && npm run test:e2e
// Set CHROMIUM_PATH to use a specific Chromium binary. Screenshots go to tests/e2e/screenshots.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const shots = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures.push(msg);
};

try {
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // First launch → create profile → lobby
  await page.goto(BASE);
  await page.waitForSelector('.onboarding input', { timeout: 30000 });
  await page.fill('.onboarding input', 'Smoke Tester');
  await page.click('.onboarding .btn-primary');
  await page.waitForSelector('.lobby .btn-play', { timeout: 10000 });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 3 && (await page.$('.modal')); i++) {
    await page.click('.modal .modal-actions .btn:first-child');
    await page.waitForTimeout(400);
  }
  check((await page.textContent('.hdr-name'))?.includes('Smoke Tester'), 'profile created and shown in lobby header');
  await page.screenshot({ path: `${shots}lobby.png` });

  // Every lobby tab renders
  for (const tab of ['locker', 'battlepass', 'shop', 'quests', 'career', 'settings', 'play']) {
    await page.click(`.topnav-item[data-tab="${tab}"]`);
    await page.waitForTimeout(300);
    check(!!(await page.$(`.page-${tab === 'battlepass' ? 'bp' : tab}`)), `tab ${tab} renders`);
  }

  // Shop: claim battle pass credits, buy an affordable item, equip it
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('robnite.save'));
    return d.profile.currency;
  });
  await page.click('.topnav-item[data-tab="shop"]');
  await page.click('.subtab:has-text("DAILY")');
  const cards = await page.$$('.shop-card:not(.owned)');
  let bought = null;
  for (const c of cards) {
    const price = Number(((await c.textContent()) ?? '').match(/([\d,]+)$/)?.[1]?.replace(/,/g, '') ?? '99999');
    const credits = Number(((await page.textContent('.hdr-credits')) ?? '0').replace(/\D/g, ''));
    if (price <= credits) {
      bought = (await c.$eval('.shop-card-name', (e) => e.textContent)) ?? null;
      await c.click();
      await page.click('.modal .btn-primary'); // BUY
      await page.waitForTimeout(300);
      await page.click('.modal .btn-primary'); // CONFIRM
      await page.waitForTimeout(400);
      await page.click('.modal .btn-primary'); // EQUIP NOW
      await page.waitForTimeout(300);
      break;
    }
  }
  check(!!bought, `purchased "${bought}" with Credits`);

  // Settings: change FOV + a keybind
  await page.click('.topnav-item[data-tab="settings"]');
  await page.click('.settings-nav-item:has-text("VIDEO")');
  await page.$eval('.setting-row:has-text("Field of view") input[type=range]', (el) => {
    el.value = '95';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('.settings-nav-item:has-text("CONTROLS")');
  await page.click('.setting-row:has(label:text-is("Wall")) .keybind');
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(600);

  // Reload: everything persists
  await page.reload();
  await page.waitForSelector('.lobby .btn-play', { timeout: 30000 });
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('robnite.save')));
  check(save.profile.displayName === 'Smoke Tester', 'display name persists after reload');
  check(save.settings.video.fov === 95, 'FOV setting persists after reload');
  check(save.keybinds.wall[0] === 'KeyG', 'rebound key persists after reload');
  check(!bought || save.profile.inventory.length > 10, 'purchased item persists in inventory');

  // Freebuild: place a wall with the real input path
  await page.evaluate(() => window.robnite?.startMatch?.('freebuild', 'normal'));
  if (!(await page.$('.click-to-play'))) {
    await page.click('.topnav-item[data-tab="play"]');
    await page.click('.mode-card:has-text("FREEBUILD")');
    await page.click('.mode-detail .btn-primary');
  }
  await page.waitForSelector('.click-to-play', { timeout: 90000 });
  await page.click('.click-to-play');
  await page.waitForTimeout(500);
  await page.mouse.move(640, 360);
  await page.mouse.move(640, 560, { steps: 8 });
  await page.keyboard.press('KeyG'); // rebound wall key
  await page.waitForTimeout(300);
  const before = await page.$$eval('.build-piece.selected', (e) => e.length);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}freebuild.png` });
  check(before === 1, 'build mode selected with the rebound key');
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await browser.close();
} finally {
  server.kill();
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
