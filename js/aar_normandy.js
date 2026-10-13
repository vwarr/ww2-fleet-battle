// aar_normandy.js - WW.aarNormandy: the after-action report for the land battle (Normandy only; visual / UI,
// docs/NORMANDY_PLAN.md P9). aar_card.js shows it in place of the fleet report when the round was Normandy: at
// 'victory' it snapshots WW.normandyGame.result() and the craft's per-sector tallies (landing_craft.js), and types a V
// Corps report on the same paper: the outcome (the beachhead won and when, the landing repulsed, the day ending with the
// beach contested), the men landed and lost and on the bluffs, the craft and tanks lost (the DD tanks launched,
// foundered, ashore), the strongpoints silenced and the draws opened and when, Pointe du Hoc, each sector's tally, the
// historical comparison (6 June 1944: V Corps ~2,400 casualties at Omaha of ~34,000 men landed; 27 of the 29 DD tanks
// the 741st launched foundered; the E-1 draw open about midday; the Rangers atop Pointe du Hoc at 07:10 and the guns found
// inland about 08:30), and the key moments from the war diary. Scale: the landing schedule (landing_waves.js) runs about
// half the craft of the day, so the counts compare as rates, not totals. Visual only: reads the sim, never writes it.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const on = () => !!WW.isScn && WW.isScn('normandy') && !!WW.normandyGame;
  const N = () => WW.scenarios.normandy;
  const num = n => (n >= 1000 ? Math.floor(n / 1000) + ',' + String(Math.round(n) % 1000).padStart(3, '0') : String(Math.round(n)));
  const pct = (a, b) => (b > 0 ? Math.round(100 * a / b) + '%' : '-');
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // the day itself (the figures the card compares against)
  const HIST = { landed: 34000, lost: 2400, ddLaunched: 29, ddLost: 27, e1: '~12:00', hocTop: '07:10', hocGuns: '~08:30' };

  function snapshot(d) {
    const R = WW.normandyGame.result(), C = N().clock, L = WW.landingCraft, I = WW.infantry, D = WW.diary;
    const all = L ? L.craft : [], dd = all.filter(u => u.type === 'dd'), ddAshore = dd.filter(u => u.state === 'unload' || (u.removed && u.state !== 'wrecked')).length;
    const secs = WW.normandyData.SECTORS.map(s => {
      const a = R.bySector[s.id] || {}, b = (L && L.stats.bySector[s.id]) || {};
      return { name: s.name, landed: a.landed || 0, lost: (a.lost || 0) + (b.lost || 0), onTop: Math.max(0, a.onTop || 0), craft: b.craft || 0, wrecked: b.wrecked || 0 };
    }).filter(s => s.craft || s.landed);
    const hoc = R.bySector.hoc || {};
    const wns = WW.coastDefence ? WW.coastDefence.wns.map(w => ({ name: w.name, wid: w.wid, draw: w.draw, hoc: w.hoc, silenced: w.silenced, at: w.silenced ? C.label(w.silencedAt) : null })) : [];
    const draws = WW.normandyData.DRAWS.map(x => ({ id: x.id, name: x.name, at: R.draws[x.id] !== undefined ? C.label(R.draws[x.id]) : null }));
    const hocTop = D ? D.entries().find(e => /atop Pointe du Hoc/.test(e.text)) : null, guns = D ? D.entries().find(e => /spike them/.test(e.text)) : null;
    const E = D ? D.entries() : [];
    const score = e => e.pri * 10 + (e.kind === 'draw' || e.kind === 'silenced' ? 4 : 0);
    const key = E.filter(e => e.pri >= 2 && e.kind !== 'victory').sort((a, b) => score(b) - score(a) || a.t - b.t).slice(0, 7).sort((a, b) => a.t - b.t);
    const how = d.reason === 'beachhead' ? 'the beachhead won at ' + C.label(R.beachheadT !== null && R.beachheadT !== undefined ? R.beachheadT : WW.game.roundTime) + ': ' + Object.keys(R.draws).length + ' draws open, ' + num(R.onTop) + ' men on the bluffs'
      : d.reason === 'repulsed' ? 'the landing repulsed: the waves spent and too few men left ashore; the follow-up diverted to Utah and Gold'
      : 'the day ended with the beach contested: ' + Object.keys(R.draws).length + ' of 5 draws open, ' + num(R.onTop) + ' men on the bluffs';
    return { nd: true, winner: d.winner, reason: d.reason, how, t0: C.label(0), t1: C.label(WW.game.roundTime), R, secs, wns, draws, dd: { launched: dd.length, foundered: R.foundered, ashore: ddAshore },
      hoc: { landed: hoc.landed || 0, lost: hoc.lost || 0, top: hocTop ? hocTop.clock : null, guns: guns ? guns.clock : null, gunsFound: !!R.hocGuns },
      key, squads: I ? I.squads.length : 0, extra: { prisoners: R.prisoners || 0, exits: (R.exits || []).length, vehicles: R.vehicles } };
  }

  const row = (k, v, h) => '<tr><td>' + k + '</td><td>' + v + '</td>' + (h !== undefined ? '<td>' + h + '</td>' : '') + '</tr>';
  function html(r) {
    const R = r.R, hm = c => (c ? c.slice(0, 2) + c.slice(3) : '');
    const silenced = r.wns.filter(w => w.silenced && !w.hoc), open = r.draws.filter(x => x.at);
    const usn = '<div class="col usn"><h3>V Corps &amp; Force O</h3>' +
      '<p><u>Men landed</u> ' + num(R.landed) + ' (' + num(R.onTop) + ' on the bluffs)</p>' +
      '<p><u>Casualties</u> ' + num(R.lost) + ' (' + pct(R.lost, R.landed + ((WW.landingCraft && WW.landingCraft.stats.menLost) || 0)) + ' of those landed)</p>' +
      '<p><u>Craft</u> ' + R.craftLost + ' of ' + R.craft + ' lost (' + R.mined + ' mined)</p>' +
      '<p><u>Tanks</u> ' + R.tanksLanded + ' ashore, ' + R.tanksLost + ' lost; DD tanks: ' + r.dd.foundered + ' of ' + r.dd.launched + ' foundered</p>' +
      '<p><u>Pointe du Hoc</u> ' + (r.hoc.top ? 'Rangers atop ' + r.hoc.top.slice(0, 2) + ':' + r.hoc.top.slice(2) : r.hoc.landed ? 'Rangers ashore, not up' : 'not reached') + (r.hoc.gunsFound ? '; the guns found and spiked' + (r.hoc.guns ? ' ' + r.hoc.guns.slice(0, 2) + ':' + r.hoc.guns.slice(2) : '') : '') + '</p>' +
      (r.extra.exits ? '<p><u>Exits open to vehicles</u> ' + r.extra.exits + '</p>' : '') + '</div>';
    const ger = '<div class="col ger"><h3>352nd Infantry Division</h3>' +
      '<p><u>Strongpoints silenced</u> ' + R.silenced + ' of ' + R.wns + (silenced.length ? ': ' + esc(silenced.map(w => w.wid.replace('WN', 'WN ') + ' ' + hm(w.at)).join(', ')) : '') + '</p>' +
      '<p><u>Positions knocked out</u> ' + R.out + '</p>' +
      '<p><u>Draws</u> ' + r.draws.map(x => esc(x.id) + (x.at ? ' open ' + hm(x.at) : ' held')).join(', ') + '</p>' +
      (r.extra.prisoners ? '<p><u>Prisoners</u> ' + r.extra.prisoners + '</p>' : '') + '</div>';
    const T = 'style="width:100%;border-collapse:collapse;font-size:11px;margin:4px 0 8px"';
    const sec = '<div class="km"><u>By sector</u><table ' + T + '><tr style="color:#7a6a58"><td>Sector</td><td>Craft (lost)</td><td>Landed</td><td>Casualties</td><td>On the bluff</td></tr>' +
      r.secs.map(s => '<tr><td>' + esc(s.name) + '</td><td>' + s.craft + (s.wrecked ? ' (' + s.wrecked + ')' : '') + '</td><td>' + num(s.landed) + '</td><td>' + num(s.lost) + '</td><td>' + num(s.onTop) + '</td></tr>').join('') + '</table></div>';
    const hist = '<div class="km"><u>Against the day (6 June 1944; this battle lands about half the craft)</u><table ' + T + '><tr style="color:#7a6a58"><td></td><td>This battle</td><td>Omaha, 6 June</td></tr>' +
      row('Casualty rate', pct(R.lost, R.landed), '~7% (2,400 of 34,000; most in the first waves)') +
      row('DD tanks foundered', r.dd.foundered + ' of ' + r.dd.launched, '27 of 29 (741st Tank Bn)') +
      row('First draw open', open.length ? open.slice().sort((a, b) => (a.at < b.at ? -1 : 1))[0].id + ' at ' + open.slice().sort((a, b) => (a.at < b.at ? -1 : 1))[0].at : 'none', 'E-1, about midday') +
      row('Rangers atop Pointe du Hoc', r.hoc.top ? r.hoc.top.slice(0, 2) + ':' + r.hoc.top.slice(2) : '-', '07:10; the guns found inland about 08:30') +
      row('Strongpoints', R.silenced + ' of ' + R.wns + ' silenced', 'all reduced by nightfall, most by the destroyers and small parties') + '</table></div>';
    return '<div class="stamp">Secret</div><div class="hd" style="letter-spacing:0.22em;font-size:22px;margin-right:90px">Report of Operations</div>' +
      '<div class="meta">V Corps, Omaha Beach  ·  6 June 1944  ·  ' + r.t0 + '–' + r.t1 + ' hrs</div>' +
      '<div class="res">' + (r.reason === 'beachhead' ? 'Beachhead won' : r.reason === 'repulsed' ? 'Landing repulsed' : 'Beach contested') + '<span>' + esc(r.how) + '</span></div>' +
      '<div class="cols">' + usn + ger + '</div>' + sec + hist +
      (r.key.length ? '<div class="km"><u>Key moments</u>' + r.key.map(e => '<div><b>' + e.clock + '</b> ' + esc(e.text) + '</div>').join('') + '</div>' : '') +
      '<div class="sig">— G-3, V Corps, for the Commanding General</div>';
  }
  WW.aarNormandy = { on, snapshot, html, HIST };
})(window.WW);
