const { chromium } = require('playwright');
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'rt'), { recursive: true }); process.chdir(__dirname);
const S = n => 'shots/rt/fc_' + n + '.png';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../index.html') + '?auto');
  await p.waitForTimeout(6000);
  await p.screenshot({ path: S('0_director') });
  // orbit drag
  await p.mouse.move(800, 450); await p.mouse.down();
  for (let i = 0; i < 20; i++) { await p.mouse.move(800 + i * 15, 450 - i * 3); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(1200);
  console.log('active after drag', await p.evaluate(() => WW.freecam.active()));
  await p.screenshot({ path: S('1_orbit') });
  // zoom in
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(80); }
  await p.waitForTimeout(1200); await p.screenshot({ path: S('2_zoom') });
  // pan with keys
  await p.keyboard.down('KeyD'); await p.waitForTimeout(1200); await p.keyboard.up('KeyD');
  await p.waitForTimeout(800); await p.screenshot({ path: S('3_pan') });
  // click follow: project a live ship to screen and click it
  const pt = await p.evaluate(() => {
    const s = WW.world.ships.find(s => s.alive && !s.submerged); if (!s) return null;
    const v = new THREE.Vector3(); s.group.getWorldPosition(v); v.project(WW.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, type: s.type, onscreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
  });
  console.log('target', JSON.stringify(pt));
  if (pt && pt.onscreen) { await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(2500); }
  console.log('following', await p.evaluate(() => { const f = WW.freecam.following(); return f ? (f.type || f.kind) : null; }));
  await p.screenshot({ path: S('4_follow') });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  console.log('following after Esc', await p.evaluate(() => !!WW.freecam.following()));
  // idle -> director resumes
  await p.waitForTimeout(23000);
  console.log('active after 23s idle', await p.evaluate(() => WW.freecam.active()));
  await p.screenshot({ path: S('5_director_back') });
  console.log('errors', errs.length, errs.slice(0, 3));
  await b.close();
})();
