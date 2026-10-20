// combat.js — owner D. Projectile pool, shells, shared hit test, AA.
// Torpedoes, bombs and depth charges are in combat_weapons.js (loads next).
window.WW = window.WW || {};
(function () {
  'use strict';
  var WW = window.WW;

  // ---------- tunables ----------
  // tracer: drawn in flight (light guns). len: mesh length. disp / c: dispersion (x range + constant).
  var BALLISTIC = {
    mg:    { tracer: true,  len: 1.6, disp: 0.04, c: 0.4 },
    small: { tracer: false, len: 1.2, disp: 0.09, c: 1.0 },   // 5-inch: no tracer in 1942 (a long glowing streak ~18 s at 1x read wrong)
    med:   { tracer: false, len: 0.7, disp: 0.10, c: 1.0 },
    big:   { tracer: false, len: 0.9, disp: 0.085, c: 1.2 }
  };
  // ---------- exterior ballistics (gunnery, 2026-10-19) ----------
  // Scale: 1 u = 9.6 m (WW.cfg.U_PER_M 0.104, ships at true size) and the ship clock (1 u/s = 5.71 kn, so one sim
  // second is ~3.27 real seconds of ship motion: docs/speed_calibration.md). The gun ranges are compressed against
  // the map's metre (a battleship's 170 u is 1.6 km in hull metres, a 1942 battle line fought at 15-25 km), so each
  // calibre reads its table at an equivalent real range: game range x REF[cal].m / REF[cal].u, the class's main-
  // battery range standing for that gun's typical 1942 battle range (about 117 m per u for the shells, 43 for the
  // light automatic guns). The flight time is the real one on the ship clock (T sim = T real / SHIP_CLOCK), so a
  // target moves as many of its own hull lengths while the shell is in the air as it did in 1942.
  // TABLE rows: [range / REF m, elevation deg, time of flight s, angle of fall deg, horizontal speed at the fall /
  // at the muzzle]. From a point-mass drag model (G7-like Cd(M), air density e^-h/9 km) fitted to each gun's
  // published maximum range (Campbell, Naval Weapons of World War Two; NavWeaps):
  //   big   16"/45 Mk 6, 1,225 kg AP at 701 m/s, 33.7 km at 45 deg      (the IJN 14"/45 is within ~10%)
  //   med   8"/55 Mk 12, 118 kg AP at 853 m/s, 29.1 km at 41 deg        (IJN 20.3 cm/50 likewise)
  //   small 5"/38, 25 kg AAC at 792 m/s, 16.6 km at 45 deg
  //   mg    20 mm Oerlikon, 123 g at 835 m/s, 4.4 km at 45 deg          (the 40 mm / .50 cal streams look the same)
  var REF = { big: { u: 170, m: 20000 }, med: { u: 120, m: 14000 }, small: { u: 70, m: 8000 }, mg: { u: 35, m: 1500 } };
  var TABLE = {
    big: [[0, 0, 0, 0, 1], [0.05, 0.57, 1.44, 0.60, 0.979], [0.10, 1.17, 2.91, 1.21, 0.959], [0.20, 2.42, 5.96, 2.58, 0.918], [0.30, 3.75, 9.15, 4.09, 0.879], [0.40, 5.16, 12.50, 5.79, 0.841], [0.50, 6.68, 16.01, 7.71, 0.805], [0.60, 8.30, 19.71, 9.84, 0.770], [0.70, 10.04, 23.61, 12.21, 0.738], [0.80, 11.92, 27.73, 14.83, 0.708], [0.90, 13.95, 32.09, 17.71, 0.681], [1.00, 16.14, 36.70, 20.84, 0.656], [1.15, 19.81, 44.20, 25.96, 0.623], [1.30, 24.06, 52.56, 31.63, 0.598]],
    med: [[0, 0, 0, 0, 1], [0.05, 0.27, 0.83, 0.28, 0.967], [0.10, 0.56, 1.70, 0.59, 0.934], [0.20, 1.18, 3.52, 1.31, 0.869], [0.30, 1.87, 5.48, 2.17, 0.807], [0.40, 2.63, 7.60, 3.19, 0.749], [0.50, 3.47, 9.88, 4.45, 0.692], [0.60, 4.41, 12.36, 5.93, 0.640], [0.70, 5.47, 15.04, 7.73, 0.590], [0.80, 6.64, 17.95, 9.90, 0.544], [0.90, 7.97, 21.12, 12.45, 0.501], [1.00, 9.45, 24.55, 15.47, 0.461], [1.15, 12.02, 30.25, 20.85, 0.411], [1.30, 15.04, 36.58, 26.98, 0.375]],
    small: [[0, 0, 0, 0, 1], [0.05, 0.18, 0.52, 0.19, 0.954], [0.10, 0.38, 1.06, 0.40, 0.909], [0.20, 0.81, 2.23, 0.94, 0.820], [0.30, 1.32, 3.53, 1.62, 0.737], [0.40, 1.90, 4.98, 2.53, 0.658], [0.50, 2.58, 6.61, 3.70, 0.586], [0.60, 3.39, 8.45, 5.25, 0.518], [0.70, 4.35, 10.53, 7.31, 0.457], [0.80, 5.50, 12.87, 9.93, 0.416], [0.90, 6.85, 15.38, 12.84, 0.394], [1.00, 8.39, 18.02, 15.93, 0.377], [1.15, 11.03, 22.22, 20.87, 0.356], [1.30, 14.05, 26.73, 26.00, 0.339]],
    mg: [[0, 0, 0, 0, 1], [0.05, 0.02, 0.09, 0.03, 0.946], [0.10, 0.06, 0.19, 0.07, 0.884], [0.20, 0.14, 0.41, 0.17, 0.767], [0.30, 0.23, 0.66, 0.33, 0.658], [0.40, 0.35, 0.95, 0.52, 0.566], [0.50, 0.50, 1.30, 0.84, 0.473], [0.60, 0.69, 1.71, 1.28, 0.405], [0.70, 0.93, 2.18, 1.84, 0.373], [0.80, 1.22, 2.68, 2.48, 0.349], [0.90, 1.55, 3.21, 3.22, 0.328], [1.00, 1.93, 3.77, 4.02, 0.311], [1.15, 2.59, 4.68, 5.39, 0.286], [1.30, 3.35, 5.66, 7.06, 0.263]]
  };
  // real knots per sim u/s (the ship clock: WW.cfg.KN_PER_U, speedcal, else 5.71); ~3.27 real s of ship motion per sim s
  function shipClock() { var c = WW.cfg || {}; return (1 / (c.U_PER_M || 0.104)) / ((c.KN_PER_U || 5.71) * 0.514444); }
  // the table read at game range d (u) for calibre cal: { el, fall (rad), T (sim s), vxr }. Pure (sim).
  var _bl = { el: 0, fall: 0, T: 0, vxr: 1 };
  function ballistic(cal, d) {
    var tb = TABLE[cal] || TABLE.small, rf = REF[cal] || REF.small, f = Math.max(0, d) / rf.u, n = tb.length;
    var i = 1; while (i < n - 1 && tb[i][0] < f) i++;
    var a = tb[i - 1], b = tb[i], k = (f - a[0]) / (b[0] - a[0]);   // past the last row: extrapolated along it
    if (k > 1 && i === n - 1) k = Math.min(k, 1 + 0.6 / (b[0] - a[0]));
    var D2R = Math.PI / 180;
    _bl.el = (a[1] + (b[1] - a[1]) * k) * D2R; _bl.fall = (a[3] + (b[3] - a[3]) * k) * D2R;
    _bl.T = (a[2] + (b[2] - a[2]) * k) / shipClock(); _bl.vxr = Math.max(0.2, a[4] + (b[4] - a[4]) * k);
    return _bl;
  }
  function tofOf(cal, d) { return Math.max(0.15, ballistic(cal, d).T); }
  // Big / medium / 5-inch shells: no tracer in 1942, and a 14-inch round in flight was all but invisible to the eye (the flash,
  // the cordite smoke, the wait, the splashes). Default: no mesh at all for them; ?shells=visible draws them again.
  var SHELLS_VISIBLE = typeof location !== 'undefined' && /[?&]shells=visible/.test(location.search);
  var AA_INTERVAL = 0.25;
  var BEAM_FRAC = 0.12;      // half-beam = length * BEAM_FRAC
  var SPOT_DISP = 0.85, SPOT_MIN = 60;  // target spotted by a scout floatplane (air_scouts.js): dispersion x0.85 beyond 60 units

  // ---------- helpers ----------
  function rnd() { return WW.rand ? WW.rand() : Math.random(); }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function fx(name, a, b, c, d, e) {
    try {
      if (WW.landFxHook && WW.landFxHook(name, a, b, c, d, e)) return;   // a scenario's own ground bursts (Normandy: beachhead_fx.js); none in the Pacific
      if (WW.fx && typeof WW.fx[name] === 'function') WW.fx[name](a, b, c, d, e);
    } catch (err) { /* never throw */ }
  }
  function stat(k, n) { if (WW.stats) WW.stats[k] = (WW.stats[k] || 0) + (n || 1); }
  function depthAt(x, z) {
    try { return (WW.terrain && WW.terrain.depthAt) ? WW.terrain.depthAt(x, z) : 10; } catch (e) { return 10; }
  }
  function shipLen(s) { return (s.stats && s.stats.length) || 12; }
  // hit-box length: the hull, but never under HIT_MIN_L (the PT length before true sizes, ship_classes.js): a true-size
  // PT (2.1-2.5 u) would be half as hittable, a balance change left to the end-of-batch pass
  var HIT_MIN_L = 5;
  function shipUsable(s) { return s && s.alive && !s.sinking; }

  // Oriented hull test. pad widens the box (splash radius etc.).
  function onHull(s, x, z, pad) {
    var h = s.heading || 0, c = Math.cos(h), sn = Math.sin(h);
    var dx = x - s.x, dz = z - s.z;
    var L = Math.max(HIT_MIN_L, shipLen(s));
    var along = dx * c + dz * sn, across = -dx * sn + dz * c;
    return Math.abs(along) < L / 2 + pad * 0.5 && Math.abs(across) < L * BEAM_FRAC + pad;
  }
  // First enemy ship (of shooterNation) whose hull covers (x,z). opts.subs: include submerged subs.
  function findHit(shooterNation, x, z, pad, includeSubmerged, prefer) {
    if (prefer && !prefer.isBase && !prefer.isLand && shipUsable(prefer) && prefer.nation !== shooterNation &&
        (includeSubmerged || !prefer.submerged) && onHull(prefer, x, z, pad)) return prefer;
    var list = (WW.world && WW.world.ships) || [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!shipUsable(s) || s.nation === shooterNation) continue;
      if (s.submerged && !includeSubmerged) continue;
      if (onHull(s, x, z, pad)) return s;
    }
    if (WW.landSites && WW.landSites.hasHit()) return WW.landSites.hitTest(shooterNation, x, z, pad, prefer); // land units (strongpoints, landing craft)
    return null;
  }
  // kind/cal (optional) let WW.damage place the right impact fx and fire site on the hull.
  // src: the projectile (optional; a land unit reads where it came from: coast_defence.js embrasures)
  function damage(s, amt, x, z, kind, cal, src) {
    try { if (s && s.alive && s.takeDamage) { s.takeDamage(amt, x, z, kind, cal, src); stat('hits'); return true; } } catch (e) { /* ignore */ }
    return false;
  }

  // ---------- shared geometry / materials / pool ----------
  var G = {}, M = {}, pool = [], bare = [], active = [], updaters = {};

  function buildShared() {
    if (G.shell || typeof THREE === 'undefined') return;
    G.shell = new THREE.BoxGeometry(1, 0.35, 0.35);
    G.torp = new THREE.BoxGeometry(2.0, 0.3, 0.3);
    G.bomb = new THREE.BoxGeometry(0.9, 0.35, 0.35);
    G.dc = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    // shells in flight stay subtle: muzzle flash and splash should draw the eye, not the round
    M.shell = new THREE.MeshBasicMaterial({ color: 0x7a7266, transparent: true, opacity: 0.6, depthWrite: false });
    M.shellBig = new THREE.MeshBasicMaterial({ color: 0x4e4a45, transparent: true, opacity: 0.7, depthWrite: false });
    // soft warm tracers (golden-hour + bloom: moderate, never pure white), partly see-through
    M.tracer = new THREE.MeshBasicMaterial({ color: 0xe6c27a, transparent: true, opacity: 0.55, depthWrite: false });
    M.tracerRed = new THREE.MeshBasicMaterial({ color: 0xe8946a, transparent: true, opacity: 0.55, depthWrite: false });
    M.torp = new THREE.MeshBasicMaterial({ color: 0x2a2f33 });
    M.bomb = new THREE.MeshBasicMaterial({ color: 0x353b2e });
    M.dc = new THREE.MeshBasicMaterial({ color: 0x222222 });
    // a falling bomb or aerial torpedo: the planes' toon material (baked vertex paint; combat_weapons.js ordGeo / airLook)
    if (WW.models && WW.models._mat) M.ord = WW.models._mat(0xffffff);
  }

  // mat === null: a projectile with no mesh at all (an unseen big / medium shell: the sim's projectile only)
  function acquire(kind, geo, mat) {
    buildShared();
    if (mat === null) {
      var b = bare.pop() || { mesh: null, bare: true };
      b.kind = kind; b.dead = false; b.t = 0;
      active.push(b);
      return b;
    }
    var p = pool.pop();
    if (!p) {
      p = { mesh: null };
      if (typeof THREE !== 'undefined') {
        p.mesh = new THREE.Mesh(geo, mat);
        p.mesh.rotation.order = 'YZX';
        p.mesh.matrixAutoUpdate = true;
      }
    } else if (p.mesh) { p.mesh.geometry = geo; p.mesh.material = mat; }
    p.kind = kind; p.dead = false; p.t = 0;
    if (p.mesh) {
      p.mesh.scale.set(1, 1, 1); p.mesh.rotation.set(0, 0, 0); p.mesh.visible = true;
      // see-through rounds (shells, tracers: depthWrite off) draw after the sea (water.js renderOrder 1, also
      // transparent): drawn before it, the sea painted over them wherever it is on screen, so a round vanished as it
      // came down below the horizon line. Opaque ones (torpedoes, bombs) keep the depth test against the sea.
      p.mesh.renderOrder = mat && mat.transparent ? 3 : 0;
      if (WW.scene) WW.scene.add(p.mesh);
    }
    active.push(p);
    return p;
  }
  function release(p) {
    if (p.mesh) { p.mesh.visible = false; if (p.mesh.parent) p.mesh.parent.remove(p.mesh); }
    p.target = null; p.owner = null; p.plane = null;
    (p.bare ? bare : pool).push(p);
  }
  // Point mesh +x along velocity.
  function orient(p, vx, vy, vz) {
    if (!p.mesh) return;
    p.mesh.rotation.y = -Math.atan2(vz, vx);
    p.mesh.rotation.z = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz));
  }
  function place(p, x, y, z) { if (p.mesh) p.mesh.position.set(x, y, z); }

  // ---------- shells ----------
  // The muzzle a round leaves from: a pure sim function of the mount layout (the model's turret: its pivot on the hull,
  // its training as ships_ai.js sets it, the barrel's trunnion and length, the shot's elevation) and the ship's x, z,
  // heading and depth: never the drawn barrel (the sea's swell, the roll and the render interpolation move that, and
  // a sim-only page would differ). Ship-local +x is the bow, +z starboard; world = (x + lx cos h - lz sin h,
  // z + lx sin h + lz cos h) (ships.js syncGroup: rotation.y = -heading). Not a ship: the shooter's own muzzle point
  // (mx / mz / muzzleY: a battery, a casemate, a plane), else its centre at its own height.
  function muzzlePos(ship, turret, el) {
    var mz = turret && turret.mz;
    if (mz && turret.obj) {
      var o = turret.obj.position, a = turret.aim !== undefined ? turret.aim : -turret.obj.rotation.y, h = ship.heading || 0, ce = Math.cos(el || 0);
      var r = mz.fx + mz.len * ce, lx = o.x + Math.cos(a) * r, lz = o.z + Math.sin(a) * r, ly = o.y + mz.by + Math.sin(el || 0) * mz.len;
      var ch = Math.cos(h), sh = Math.sin(h);
      return { x: ship.x + lx * ch - lz * sh, y: Math.max(0.3, (ship.depthY || 0) + ly), z: ship.z + lx * sh + lz * ch };
    }
    var y = ship.muzzleY !== undefined ? ship.muzzleY : isFinite(ship.y) && ship.y > 0 ? ship.y : 2;   // muzzleY: a gun on land (coast_defence.js, island_base.js)
    return { x: ship.mx !== undefined ? ship.mx : ship.x, y: y, z: ship.mz !== undefined ? ship.mz : ship.z };
  }

  function fireShell(ship, turret, target, cal) {
    try {
      if (!ship || !target || !target.alive) return null;
      cal = (WW.SHELL && WW.SHELL[cal]) ? cal : 'small';
      buildShared();
      var S = WW.SHELL[cal], B = BALLISTIC[cal];
      var m0 = muzzlePos(ship, turret, 0);
      var tsp = target.speed || 0, th = target.heading || 0;
      var tvx = Math.cos(th) * tsp, tvz = Math.sin(th) * tsp;
      // lead: two passes of the time-of-flight estimate (the range table)
      var T = tofOf(cal, Math.hypot(target.x - m0.x, target.z - m0.z));
      var ax = target.x + tvx * T, az = target.z + tvz * T;
      T = tofOf(cal, Math.hypot(ax - m0.x, az - m0.z));
      ax = target.x + tvx * T; az = target.z + tvz * T;
      // dispersion grows with range
      var dist = Math.hypot(ax - m0.x, az - m0.z);
      var r = (B.disp * dist + B.c) * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
      if (dist > SPOT_MIN && target.spottedUntil > (WW.time ? WW.time.now : 0)) r *= SPOT_DISP;
      ax += Math.cos(a) * r; az += Math.sin(a) * r;
      var D = Math.hypot(ax - m0.x, az - m0.z), bl = ballistic(cal, D);
      T = Math.max(0.15, bl.T);
      var el = bl.el, tanF = Math.tan(bl.fall), vxr = bl.vxr;
      if (turret && turret.gunG) { turret.el = el; turret.gunG.rotation.z = el; }   // the barrels laid for this shot (models.js turret gunG; ships_ai.js holds it)
      var m = turret && turret.mz ? muzzlePos(ship, turret, el) : m0;

      var seen = B.tracer || SHELLS_VISIBLE;
      var p = acquire('shell', G.shell, !seen ? null : B.tracer ? (ship.nation === 'IJN' ? M.tracerRed : M.tracer) : cal === 'big' ? M.shellBig : M.shell);
      p.cal = cal; p.nation = ship.nation; p.target = target; p.owner = ship;
      p.x0 = m.x; p.y0 = m.y; p.z0 = m.z; p.T = T;
      p.vx = (ax - m.x) / T; p.vz = (az - m.z) / T;   // mean horizontal velocity: x0 + vx T is the fall of shot (camera_director.js reads it)
      p.ty = target.y || 0;                    // the target's height (a casemate on the bluff top; ships: 0)
      // The flight's shape (visual only; the sim needs T and the fall of shot): s(tau) = (1+q) tau - q tau^2 is the
      // share of the range flown at tau = t / T, its slope falling from 1+q to 1-q (horizontal speed lost to drag:
      // (1-q)/(1+q) = vxr); the height over the chord is D (A s + B s^2 + C s^3), leaving at the elevation (A = tan el)
      // and coming down at the angle of fall (y'(1) = -tan fall), the apex past mid-range as a real shell's.
      p.D = Math.hypot(p.vx, p.vz) * T; p.q = (1 - vxr) / (1 + vxr);
      p.cA = Math.tan(el); p.cC = p.cA - tanF; p.cB = -2 * p.cA + tanF;
      p.dmg = S.dmg * rr(0.8, 1.2);
      if (p.mesh) {
        var k = cal === 'big' ? 0.95 : cal === 'med' ? 0.7 : cal === 'small' ? 0.6 : 0.45;
        if (B.tracer) p.mesh.scale.set(B.len * k * 1.2, k * 0.6, k * 0.6); else p.mesh.scale.set(B.len * k, k, k);
        poseShell(p);
      }
      fx('muzzleFlash', m.x, m.y, m.z);
      if (WW.emit) WW.emit('shellFired', { ship: ship, cal: cal, x: m.x, y: m.y, z: m.z, proj: p }); // sound hook (audio_*.js)
      stat('shellsFired');
      return p;
    } catch (e) { return null; }
  }

  function poseShell(p) {
    var tau = Math.min(p.t, p.T) / p.T, s = (1 + p.q) * tau - p.q * tau * tau, ds = (1 + p.q) - 2 * p.q * tau;   // ds: d s / d tau
    var x = p.x0 + p.vx * p.T * s, z = p.z0 + p.vz * p.T * s;
    var y = p.y0 + (p.ty - p.y0) * s + p.D * s * (p.cA + s * (p.cB + s * p.cC));
    var dy = (p.ty - p.y0) + p.D * (p.cA + s * (2 * p.cB + 3 * s * p.cC));      // d y / d s
    place(p, x, y, z); orient(p, p.vx * ds, dy * ds / p.T, p.vz * ds);
  }
  function updateShell(p, dt) {
    p.t += dt;
    if (p.mesh) poseShell(p);   // an unseen shell (no mesh): only its clock runs
    if (p.t < p.T) return;
    landShell(p, p.x0 + p.vx * p.T, p.z0 + p.vz * p.T);
    p.dead = true;
  }

  function landShell(p, x, z) {
    var S = WW.SHELL[p.cal];
    var tgt = (p.target && p.target.alive) ? p.target : null;
    var hit = findHit(p.nation, x, z, S.splash * 0.3, false, tgt);
    if (WW.emit) WW.emit('shellLanded', { cal: p.cal, x: x, z: z, ship: hit, proj: p }); // sound hook (audio_naval_wire.js)
    if (hit) {
      damage(hit, p.dmg, x, z, 'shell', p.cal, p);
      if (WW.damage && !hit.isLand) return;   // impact fx at the hull hit point are placed by WW.damage
      var big = p.cal === 'big' || p.cal === 'med';
      if (p.cal === 'mg') fx('sparks', x, 1, z);
      else { fx('explosion', x, 1.2, z, S.splash * 0.6); if (big) fx('sparks', x, 1.5, z); else fx('sparks', x, 1, z); }
      return;
    }
    if (WW.landSites) WW.landSites.impact(p.nation, x, z, p.dmg, 'shell', p.cal); // the land targets: the island base (craters, facilities), Normandy's strongpoints (land_sites.js)
    if (depthAt(x, z) <= 0) {
      fx('explosion', x, 0.6, z, Math.max(0.4, S.splash * 0.35));
      fx('smoke', x, 0.8, z, false, S.splash * 0.5);
    } else {
      fx('splash', x, z, S.splash);
    }
  }

  // ---------- AA ----------
  var aaTimer = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

  function aaTracer(sx, sy, sz, px, py, pz, nation) {
    var dx = px - sx, dy = py - sy, dz = pz - sz;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var R = Math.random, sp = 90, life = Math.min(0.45, (d / sp) * (0.5 + 0.4 * R())); // visual only: Math.random
    var p = acquire('tracer', G.shell, nation === 'IJN' ? M.tracerRed : M.tracer);
    p.x0 = sx; p.y0 = sy; p.z0 = sz;
    p.vx = dx / d * sp + (R() - 0.5) * 12; p.vy0 = dy / d * sp + (R() - 0.5) * 12; p.vz = dz / d * sp + (R() - 0.5) * 12;
    p.life = life;
    p.len = 1.3;
    if (p.mesh) p.mesh.scale.set(p.len, 0.2, 0.2);
    place(p, sx, sy, sz); orient(p, p.vx, p.vy0, p.vz);
  }
  function updateTracer(p, dt) {
    p.t += dt;
    if (p.t >= p.life) { p.dead = true; return; }
    place(p, p.x0 + p.vx * p.t, p.y0 + p.vy0 * p.t, p.z0 + p.vz * p.t);
    var f = Math.min(1, (p.life - p.t) / (p.life * 0.4)); // short fade-out: shrink over the last 40% of its life
    if (p.mesh) p.mesh.scale.set(p.len * f, 0.2 * (0.4 + 0.6 * f), 0.2 * (0.4 + 0.6 * f));
  }

  function updateAA(dt) {
    if (WW.combatAA) { WW.combatAA.update(dt); return; } // heavy/light AA, flak bursts, jinking: combat_aa.js
    var ships = (WW.world && WW.world.ships) || [], planes = (WW.world && WW.world.planes) || [];
    if (!planes.length || !aaTimer) return;
    for (var i = 0; i < ships.length; i++) {
      var s = ships[i];
      if (!shipUsable(s) || s.submerged || !s.stats || !s.stats.aa) continue;
      var tm = (aaTimer.get(s) || 0) - dt;
      if (tm > 0) { aaTimer.set(s, tm); continue; }
      aaTimer.set(s, tm + AA_INTERVAL > 0 ? tm + AA_INTERVAL : AA_INTERVAL * rnd());
      var aa = s.stats.aa, best = null, bd = aa.range * aa.range;
      for (var j = 0; j < planes.length; j++) {
        var pl = planes[j];
        if (!pl || !pl.alive || pl.nation === s.nation) continue;
        var dx = pl.x - s.x, dz = pl.z - s.z, dy = (pl.y || 0);
        var d2 = dx * dx + dz * dz + dy * dy;
        if (d2 < bd) { bd = d2; best = pl; }
      }
      if (!best) continue;
      var d = Math.sqrt(bd), frac = d / aa.range;
      var hc = 0.35 * (1.4 - 0.8 * frac) * (best.kind === 'fighter' ? 0.6 : 1);
      try { if (best.damage) best.damage(aa.dps * AA_INTERVAL * hc); } catch (e) { /* ignore */ }
      if (rnd() < 0.7) fx('flak', best.x + rr(-3, 3), (best.y || 5) + rr(-2, 3), best.z + rr(-3, 3));
      if (Math.random() < 0.5) { // about half as many tracers as before (visual only)
        var R = Math.random;
        aaTracer(s.x + (R() - 0.5) * 4, 2.5, s.z + (R() - 0.5) * 4,
                 best.x + (R() - 0.5) * 4, (best.y || 5) + (R() - 0.5) * 2, best.z + (R() - 0.5) * 4, s.nation);
      }
    }
  }

  // ---------- module ----------
  WW.combat = {
    init: function () { buildShared(); },
    update: function (dt) {
      if (!(dt > 0)) return;
      try { updateAA(dt); } catch (e) { /* never throw */ }
      for (var i = 0; i < active.length; i++) {
        var p = active[i];
        try {
          if (p.kind === 'shell') updateShell(p, dt);
          else if (p.kind === 'tracer') updateTracer(p, dt);
          else if (updaters[p.kind]) updaters[p.kind](p, dt);
          else p.dead = true;
        } catch (e) { p.dead = true; }
      }
      // compact
      var w = 0;
      for (var r = 0; r < active.length; r++) {
        var q = active[r];
        if (q.dead) release(q); else active[w++] = q;
      }
      active.length = w;
    },
    clearAll: function () {
      for (var i = 0; i < active.length; i++) release(active[i]);
      active.length = 0;
      if (typeof WeakMap !== 'undefined') aaTimer = new WeakMap();
      if (WW.combatAA) WW.combatAA.clearAll();
    },
    fireShell: fireShell,
    // the range table (gunnery): the barrels' elevation (rad) for a shot at game range d, the time of flight (sim s)
    elevOf: function (cal, d) { return ballistic(cal, d).el; },
    tofOf: tofOf,
    ballistic: function (cal, d) { var b = ballistic(cal, d); return { el: b.el, fall: b.fall, T: b.T, vxr: b.vxr }; },
    muzzlePos: muzzlePos,
    // internals shared with combat_weapons.js
    _i: {
      acquire: acquire, place: place, orient: orient, findHit: findHit, onHull: onHull,
      damage: damage, fx: fx, stat: stat, depthAt: depthAt, rnd: rnd, rr: rr,
      G: G, M: M, buildShared: buildShared, updaters: updaters, shipUsable: shipUsable,
      active: active // live projectiles (read-only outside combat: intel.js torpedo sightings)
    },
    _debug: function () { return { active: active.length, free: pool.length, total: active.length + pool.length }; }
  };
})();
