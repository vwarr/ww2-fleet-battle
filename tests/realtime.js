const { chromium } = require('playwright');
require('fs').mkdirSync(require('path').join(__dirname, 'shots', 'rt'), { recursive: true }); process.chdir(__dirname);
const S = n => 'shots/rt/' + n + '.png';
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: false });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  // 1) file:// load
  await p.goto('file://' + require('path').resolve(__dirname, '../index.html') + '?auto');
  await p.waitForTimeout(3000);
  await p.screenshot({ path: S('file_load') });
  console.log('file:// errors', errs.length, errs.slice(0,3));
  // 2) real-time 1x watch, ~2.5 min
  for (let i = 0; i < 15; i++) { await p.waitForTimeout(i === 0 ? 1000 : 10000); await p.screenshot({ path: S('t' + String(i).padStart(2,'0')) }); }
  console.log('sim time after watch', await p.evaluate(() => WW.game.roundTime && WW.game.roundTime.toFixed(1)), 'state', await p.evaluate(() => WW.game.state));
  // 3) setup flow
  await p.evaluate(() => WW.game.enterSetup(true));
  await p.waitForTimeout(1500);
  await p.evaluate(() => { WW.game.composition = []; WW.game.enterSetup(false); });
  await p.waitForTimeout(800);
  const spots = [[300,450],[380,560],[250,620],[1300,450],[1220,560],[1350,620]];
  for (let i = 0; i < spots.length; i++) {
    if (i === 3) await p.getByText(/^Side:/).click();
    await p.mouse.click(spots[i][0], spots[i][1]); await p.waitForTimeout(250);
  }
  await p.waitForTimeout(800);
  console.log('placed', await p.evaluate(() => (WW.game.composition||[]).map(c => c.nation[0] + c.type).join(' ')));
  await p.screenshot({ path: S('setup_placed') });
  await p.getByText('Start', { exact: true }).click();
  await p.waitForTimeout(6000);
  await p.screenshot({ path: S('setup_started') });
  console.log('state after start', await p.evaluate(() => WW.game.state), 'total errors', errs.length, errs.slice(0,3));
  await b.close();
})();
