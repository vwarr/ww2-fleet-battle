// sky_time.js - WW.skyTime: the look of the time of day and the weather (visual only; render mode). sky.update calls
// it every frame. It reads the sim's clock (daylight.js: WW.dayNight.sunElev, sunAz, morning(); WW.daylight) and
// WW.weather, and sets the sky dome (the sun's place, its disc and halo, the palette, stars and moon), the sun / moon
// light and the sky fill, the fog, the clouds, the water (tint, horizon colours, the glitter and its path) and the
// bloom (post.js setNight).
// Keyframes on the sun's elevation E (degrees): 70 high noon (bright, clear, white light), 45, 22 the golden
// afternoon (the game's original look), 10 golden, 3 the sun on the horizon (a strong orange / pink sky, a big glowing
// disc, gold-to-orange glitter, clouds lit warm from below), -1 afterglow, -5 the blue hour, -10 a moonlit night.
// Before noon the low-sun keys use a cooler dawn palette (pink, peach and lavender), blended by WW.dayNight.morning().
// Rain darkens and greys it all.
window.WW = window.WW || {};
(function (WW) {
  const KEYS = [-10, -5, -1, 3, 10, 22, 45, 70];
  const C = h => (WW.pastel ? WW.pastel(h, 0.1) : new THREE.Color(h));
  const pal = (...hex) => hex.map(C);
  //              night     blue hr   afterglow sun on hz golden    afternoon bright    noon
  const PM = {
    zenith:  pal(0x1d3066, 0x2a3a7c, 0x3e4c98, 0x4e5ea8, 0x4a78c8, 0x3f7fd6, 0x3a84de, 0x3a88e2),
    sunSide: pal(0x2f4a84, 0x8a6aa8, 0xff6e5c, 0xff8040, 0xffa868, 0xffc89a, 0xf0e2d0, 0xe2eef8),
    away:    pal(0x2a4377, 0x56679f, 0xa48cc4, 0xc0a6c8, 0xbcc6e4, 0xb4d2f2, 0xb8d8f4, 0xbcdcf6),
    glow:    pal(0x30498a, 0xb07e9a, 0xff7848, 0xffa040, 0xffc078, 0xffe0b0, 0xfff0d8, 0xfff6e8),
    fog:     pal(0x2c4476, 0x5a6aa0, 0xcc8ca8, 0xf0ae94, 0xe6cfd2, 0xc4dcf2, 0xc6e0f4, 0xc8e2f6),
    hemiSky: pal(0x7088d0, 0x8a8ccc, 0xd8a6c0, 0xf6c8b8, 0xf2e0e2, 0xe6ecfa, 0xeaf0fc, 0xeef4ff),
    hemiGnd: pal(0x34406e, 0x4a4a7c, 0x8a76a8, 0xb898b8, 0xc8b2cc, 0xc4b8d8, 0xc6c0da, 0xc8c4dc),
    light:   pal(0xa4bcff, 0x8890c8, 0xff6a44, 0xff7a36, 0xffa45c, 0xffc890, 0xffe6c4, 0xfff4e6),
    cloud:   pal(0x404c6e, 0x8c86aa, 0xf094a0, 0xffb08a, 0xfad8c4, 0xeee8e2, 0xf2f0ee, 0xf6f6f6),
    cloudEm: pal(0x141c34, 0x3c3c6c, 0xa86890, 0xd8809a, 0xc8a4c4, 0xb8c4e6, 0xbccaea, 0xc0d0ee),
    glit:    pal(0xc8d6ff, 0x9098c8, 0xff5a30, 0xff8a2a, 0xffb456, 0xffd2a0, 0xfff0d8, 0xfff8ee)
  };
  // morning: the low-sun keys (blue hour .. afternoon) in dawn colours; the rest as above
  const AM = {};
  const DAWN = {
    zenith:  [0x2a3a7c, 0x3a4c9c, 0x4e68b4, 0x4682d6, 0x3a84e0],
    sunSide: [0x8a6aa8, 0xe88aa8, 0xffa0a0, 0xffd0b0, 0xf6e2d0],
    away:    [0x56679f, 0x9a90c8, 0xb8b0d8, 0xb2cdf0, 0xb0d4f6],
    glow:    [0xb07e9a, 0xf09ab0, 0xffb8a0, 0xffd8b8, 0xffeed8],
    fog:     [0x5a6aa0, 0xb898c0, 0xe8c4cc, 0xd2dcee, 0xc2dcf4],
    hemiSky: [0x8a8ccc, 0xd0a8cc, 0xf0d0d8, 0xeee6f0, 0xe8eefa],
    light:   [0x8890c8, 0xe08898, 0xff9c88, 0xffc4a0, 0xffe8cc],
    cloud:   [0x8c86aa, 0xe8a0b8, 0xffc4c0, 0xfce0d8, 0xf2ece8],
    cloudEm: [0x3c3c6c, 0xa07098, 0xc890b0, 0xc8acc8, 0xbcc6e8],
    glit:    [0x9098c8, 0xf08aa0, 0xffa090, 0xffcca8, 0xffe4c4]
  };
  for (const k in PM) { AM[k] = PM[k].slice(); if (DAWN[k]) for (let i = 0; i < 5; i++) AM[k][i + 1] = C(DAWN[k][i]); }
  const NUM = {
    hemiI:  [0.66, 0.56, 0.56, 0.62, 0.68, 0.72, 0.74, 0.75],
    lightI: [0.62, 0.14, 0.55, 0.95, 1.1, 1.15, 1.14, 1.12],
    halo:   [0.4, 0.5, 0.95, 0.95, 0.7, 0.55, 0.42, 0.36],
    disc:   [0, 0.2, 1.3, 1.5, 0.75, 0.45, 0.4, 0.35],
    discCos:[0.9997, 0.9997, 0.9991, 0.9992, 0.9996, 0.99975, 0.9998, 0.9998],   // the disc looks bigger near the horizon
    spread: [3, 3, 2, 2.2, 3.2, 5, 6, 7],
    tint:   [[0.36, 0.44, 0.68], [0.5, 0.52, 0.74], [0.88, 0.7, 0.76], [1, 0.84, 0.78], [1, 0.95, 0.92], [1, 1, 1], [1, 1.01, 1.02], [0.99, 1.01, 1.03]]
  };
  const RAIN_FOG = C(0x8c98ac), MOON_GLIT = new THREE.Color(1.25, 1.3, 1.5);
  // Land at a high sun: the flat ground (sand, grass, the base's strips and berms) faces a high sun square on, and its
  // light (sun x sin(elevation) + sky fill) went from ~1.0 at 17:00 to ~1.75 at noon: the colours ran past the tone
  // curve's shoulder (post.js, 0.72) and rolled to near-white. So the land's colour is scaled by LAND_CAP / that light,
  // capped at 1 (a low sun: dawn, the golden afternoon and dusk unchanged; 17:00's light is ~0.93, landK 1). LAND_CAP
  // 0.93 (was 1.15: the noon sand still rolled to a pale cream, 236/228/201, against 190/167/135 at 17:00). The terrain
  // floor takes it in its shader, the seabed too (terrain.js: the pale sand under the shallows otherwise whitened the
  // lagoon at noon); the toon
  // base materials (addLand: models_base.js) barely brighten with the sun's height (their gradient's top steps), so
  // they take its square root. Ships, planes and buildings are left alone.
  const LAND_CAP = 0.93, LAND_TOON = 0.75, LAND = [], landK = { value: 1 };
  const lum = c => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  const MOON = new THREE.Vector3(0.82, 0.26, -0.5).normalize();   // a low moon (~15 deg) in the east: a long glitter path
  let wx = 0, t = 0, cloudMat = null, gradeOn = false;
  const domeSun = new THREE.Vector3(), lightDir = new THREE.Vector3(), glitDir = new THREE.Vector3(), tmp = new THREE.Color(), tmp2 = new THREE.Color(), v3 = new THREE.Vector3();

  function seg(e) { let i = 0; while (i < KEYS.length - 2 && e > KEYS[i + 1]) i++; return [i, WW.clamp((e - KEYS[i]) / (KEYS[i + 1] - KEYS[i]), 0, 1)]; }
  let E = 22, AMk = 0;
  // the palette colour at the current elevation, morning and afternoon blended
  function col(name, out) {
    const [i, f] = seg(E), a = PM[name], b = AM[name];
    out.copy(a[i]).lerp(a[i + 1], f);
    if (AMk > 0) { tmp2.copy(b[i]).lerp(b[i + 1], f); out.lerp(tmp2, AMk); }
    return out;
  }
  function num(arr) { const [i, f] = seg(E); return WW.lerp(arr[i], arr[i + 1], f); }
  function dirAt(out, az, elevDeg) { const e = elevDeg * Math.PI / 180; return out.set(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)); }

  function update(rdt) {
    const P = WW.sky && WW.sky.parts && WW.sky.parts();
    if (!P || !P.dome) return;
    t += rdt || 0;
    const D = WW.dayNight, k = WW.clamp(WW.daylight === undefined ? 1 : WW.daylight, 0, 1), n = 1 - k;
    E = D ? D.sunElev : 22; AMk = D ? D.morning() : 0;
    const az = D ? D.sunAz : Math.atan2(0.36, -0.86);
    // weather near what the camera looks at (smoothed, so a cut does not pop the fog)
    let cov = 0;
    const Wx = WW.weather;
    if (Wx && (Wx.cells.length || Wx.rainAll) && WW.camera) {   // rain only (an overcast deck is the grey sky below, not fog)
      const tg = WW.cam && WW.cam.target ? WW.cam.target() : null;
      cov = Math.max(Wx.rain(WW.camera.position.x, WW.camera.position.z) * 0.8, tg ? Wx.rain(tg.x, tg.z) : 0);
    }
    // a scenario's overcast (Normandy: the grey morning of 6 June 1944) greys and dims it as a light rain would, with
    // its haze thinner than a squall's (wr: the fog distance)
    // the round's own grey sky (weather.js: overcast, thunderstorm, typhoon) the same way
    const oc = Math.max((WW.scn && WW.scn().overcast) || 0, Wx ? Wx.overcast * 0.7 : 0);
    wx += (Math.max(cov, oc) - wx) * Math.min(1, (rdt || 0.016) * 1.5);
    const wr = Math.max(0, wx - oc) + oc * 0.45;
    const dim = 1 - 0.35 * wx;
    // dome: palette, the sun's place, disc and halo, stars and moon
    const u = P.dome.material.uniforms;
    col('zenith', u.zenith.value); col('sunSide', u.sunSide.value); col('away', u.away.value); col('glow', u.glow.value);
    if (wx > 0.01) { u.zenith.value.lerp(RAIN_FOG, wx * 0.5); u.sunSide.value.lerp(RAIN_FOG, wx * 0.6); u.away.value.lerp(RAIN_FOG, wx * 0.6); }
    dirAt(domeSun, az, E); u.sunDir.value.copy(domeSun);
    u.halo.value = num(NUM.halo); u.disc.value = num(NUM.disc) * (1 - wx); u.discCos.value = num(NUM.discCos); u.spread.value = num(NUM.spread);
    u.night.value = WW.clamp((-3 - E) / 7, 0, 1) * (1 - wx); u.time.value = t;
    u.moonDir.value.copy(MOON);
    // light: the sun (kept 6 deg up for the shadows: long at sunset) until it sets, then the moon; swapped while dim
    const sd = dirAt(v3, az, Math.max(6, E));
    const f = WW.clamp((-1 - E) / 4, 0, 1);
    lightDir.copy(sd).lerp(MOON, f).normalize();
    WW.sky.SUN_DIR.copy(lightDir);
    col('light', P.sun.color); P.sun.intensity = num(NUM.lightI) * dim;
    col('hemiSky', P.hemi.color); col('hemiGnd', P.hemi.groundColor); P.hemi.intensity = num(NUM.hemiI) * (1 - 0.2 * wx);
    const lk = Math.min(1, LAND_CAP / (P.sun.intensity * Math.max(0, lightDir.y) * lum(P.sun.color) + P.hemi.intensity * lum(P.hemi.color)));
    landK.value = lk;
    for (const m of LAND) m.color.setScalar(Math.pow(lk, LAND_TOON));
    // fog and background
    const fog = WW.scene.fog;
    if (fog) {
      col('fog', fog.color);
      if (wx > 0.01) { tmp.copy(RAIN_FOG).multiplyScalar(0.45 + 0.55 * k); fog.color.lerp(tmp, wx * 0.7); fog.near *= 1 - 0.9 * wr; fog.far *= 1 - 0.78 * wr; }
      if (WW.scene.background && WW.scene.background.isColor) WW.scene.background.copy(fog.color);
    }
    // clouds (lit warm from below at sunset: the emissive carries it)
    if (!cloudMat && P.clouds && P.clouds.children[0]) cloudMat = P.clouds.children[0].children[0].material;
    if (cloudMat) { col('cloud', cloudMat.color); col('cloudEm', cloudMat.emissive); }
    // water: tint, horizon colours, the glitter (sun by day, moon by night) and its path when the light is low
    const wu = WW.water && WW.water.uniforms && WW.water.uniforms();
    if (wu) {
      const tn = NUM.tint, [i, g] = seg(E);
      wu.tint.value.setRGB(WW.lerp(tn[i][0], tn[i + 1][0], g), WW.lerp(tn[i][1], tn[i + 1][1], g), WW.lerp(tn[i][2], tn[i + 1][2], g)).multiplyScalar(1 - 0.18 * wx);
      col('away', wu.hzAway.value); col('sunSide', wu.hzSun.value);
      if (fog && wx > 0.01) { wu.hzAway.value.lerp(fog.color, wx); wu.hzSun.value.lerp(fog.color, wx); }
      let path;
      if (E > -2.5) {   // the sun: a gold path that turns orange as it sets
        dirAt(glitDir, az, Math.max(1.5, E)); col('glit', wu.sunCol.value).multiplyScalar(WW.clamp((E + 2.5) / 3, 0, 1));
        path = WW.clamp((14 - E) / 10, 0, 1) * 0.9;
      } else {          // the moon
        glitDir.copy(MOON); wu.sunCol.value.copy(MOON_GLIT).multiplyScalar(WW.clamp((-2.5 - E) / 4, 0, 1));
        path = 1;
      }
      wu.sunCol.value.multiplyScalar(1 - 0.85 * wx); wu.sunDir.value.copy(glitDir);   // (merged uniforms are copies)
      const m = WW.clamp((-3 - E) / 6, 0, 1);
      wu.glit.value.set(0.1 - 0.05 * m, 420, 0.35 - 0.25 * m); wu.moonPath.value = path * (1 - wx);
      const cells = WW.weather ? WW.weather.cells : [];
      for (let j = 0; j < 4; j++) { const c = cells[j]; if (c) wu.rainC.value[j].set(c.x, c.z, c.r, c.dens); else wu.rainC.value[j].set(0, 0, 0, 0); }
    }
    if (oc > 0) overcast(P, Math.min(1, oc / 0.7), u, wu);
    storm(P, Wx, cov, rdt, wu);
    // bloom: night, and a warm glow round a low sun (none behind an overcast; and a greyer grade under it)
    const golden = E > -3 ? WW.clamp((12 - E) / 10, 0, 1) : 0;
    if (WW.post && WW.post.setNight) {
      if (oc > 0) { const g = Math.min(1, oc / 0.7); WW.post.setGrade(-0.32 * g, 1 - 0.1 * g, 1 - 0.07 * g, 1 - 0.02 * g); WW.post.setNight(n * 0.6); }   // cold, grey, a shade darker
      else { if (gradeOn) WW.post.setGrade(0, 1, 1, 1); WW.post.setNight(Math.max(n, 0.5 * golden)); }
      gradeOn = oc > 0;
    }
    if (WW.nightFx) WW.nightFx.update(rdt || 0);      // night_fx.js: lights, star shells, searchlights
    if (WW.weatherFx) WW.weatherFx.update(rdt || 0);  // weather_fx.js: rain curtains, cloud decks
  }
  // A scenario's overcast (Normandy, 6 June 1944: a low grey deck at 1,000-3,000 ft, broken to unbroken; flat,
  // diffuse light; a grey horizon; moderate visibility in haze and smoke). The fair-weather palette above (pink and
  // lavender at a low morning sun) is replaced, not tinted: a grey dome a little brighter toward the sun (east) with
  // no disc, no stars, a neutral weak sun (soft, faint shadows) and a strong grey sky fill, a grey-green sea with no
  // glitter path, the fog grey and closer, the Pacific's white cumulus hidden (normandy_sky.js draws the deck). g:
  // the overcast's weight (1: Normandy's 0.7). Twilight (before ~06:00) darkens it toward a blue-grey.
  const OV = {   // [twilight, day]
    zenith: pal(0x4c5462, 0x868d94), away: pal(0x5e6674, 0xa2a8ac), sunSide: pal(0x7a7480, 0xc0bfb8),
    glow: pal(0x8a8088, 0xcfccc2), fog: pal(0x5c6472, 0x9ea4a8), hemiSky: pal(0x8a92a4, 0xdfe2e2),
    hemiGnd: pal(0x50545c, 0x8e9088), light: pal(0x9a9cb0, 0xe8e4da), glit: pal(0x404450, 0x8a8a84)
  };
  function ov(name, lb, out) { return out.copy(OV[name][0]).lerp(OV[name][1], lb); }
  function overcast(P, g, u, wu) {
    const lb = WW.clamp((E + 7) / 15, 0, 1), ls = lb * lb * (3 - 2 * lb);   // twilight 0 .. full grey day 1 (-7 .. 8 deg)
    const L = (name, c) => c.lerp(ov(name, ls, tmp), g);
    L('zenith', u.zenith.value); L('away', u.away.value); L('sunSide', u.sunSide.value); L('glow', u.glow.value);
    u.disc.value *= 1 - g; u.halo.value = WW.lerp(u.halo.value, 0.22, g); u.spread.value = WW.lerp(u.spread.value, 1.6, g); u.night.value *= 1 - g;
    L('light', P.sun.color); P.sun.intensity = WW.lerp(P.sun.intensity, 0.36 * (0.45 + 0.55 * ls), g);
    L('hemiSky', P.hemi.color); L('hemiGnd', P.hemi.groundColor); P.hemi.intensity = WW.lerp(P.hemi.intensity, 0.78 * (0.68 + 0.32 * ls), g);
    landK.value = 1; for (const m of LAND) m.color.setScalar(1);
    const fog = WW.scene.fog;
    if (fog) {
      L('fog', fog.color);
      // the haze thins with height: a high camera (the overview, a map-like view) still reads the whole coast
      const hy = WW.camera ? WW.clamp(WW.camera.position.y, 0, 900) : 0, ovw = WW.cam && WW.cam.isOverview && WW.cam.isOverview();
      fog.near = WW.lerp(fog.near, ovw ? 1500 : 260 + hy * 2.4, g);
      fog.far = WW.lerp(fog.far, ovw ? 4200 : 1500 + hy * 5.5, g);
      if (WW.scene.background && WW.scene.background.isColor) WW.scene.background.copy(fog.color);
    }
    if (P.clouds) P.clouds.visible = false;   // no fair-weather cumulus under the deck
    if (wu) {
      wu.tint.value.setScalar(WW.lerp(1, 0.94, g) * (0.74 + 0.26 * ls));
      if (fog) { wu.hzAway.value.copy(fog.color); wu.hzSun.value.copy(fog.color).lerp(u.sunSide.value, 0.35); }
      L('glit', wu.sunCol.value); wu.moonPath.value *= 1 - g; wu.glit.value.set(0.05, 420, 0.12);
    }
  }
  // The round's weather on top (weather.js; visual): fewer fair-weather cumulus on a clear day, every one of them on a
  // cumulus day; under a thunderstorm or a typhoon a darker light, the rain's fog closing in again after the overcast's
  // haze (overcast() sets the fog for the deck alone), lightning (weather_fx.js flash) and, in a typhoon, rain on the
  // sea everywhere round the camera (water.js rainC's last slot).
  let rn = 0;
  function storm(P, Wx, cov, rdt, wu) {
    if (!Wx) return;
    rn += (cov - rn) * Math.min(1, (rdt || 0.016) * 1.5);
    const kind = Wx.kind, heavy = kind === 'thunder' || kind === 'typhoon';
    if (P.clouds && P.clouds.visible) { const ch = P.clouds.children; for (let i = 0; i < ch.length; i++) ch[i].visible = kind !== 'clear' || i % 3 !== 0; }
    if (heavy) {
      const k = kind === 'typhoon' ? 0.6 : 0.72;
      P.sun.intensity *= k; P.hemi.intensity *= k + 0.1;
      const fog = WW.scene.fog;
      if (fog && Wx.overcast > 0 && rn > 0.01) {
        fog.near *= 1 - 0.85 * rn; fog.far *= 1 - 0.7 * rn;
        if (kind === 'typhoon') {   // driving rain and spume: under a kilometre (~100 u) at sea level, a little more from high up
          const hy = WW.camera ? WW.clamp(WW.camera.position.y, 0, 900) : 0, k = Math.min(1, rn / 0.6);
          fog.near = WW.lerp(fog.near, 10 + hy * 0.5, k); fog.far = WW.lerp(fog.far, 240 + hy * 2.2, k);
        }
        if (WW.scene.background && WW.scene.background.isColor) WW.scene.background.copy(fog.color);
      }
    }
    const fl = WW.weatherFx && WW.weatherFx.flash ? WW.weatherFx.flash() : 0;
    if (fl > 0) { P.hemi.intensity += 1.6 * fl; P.dome.material.uniforms.zenith.value.offsetHSL(0, -0.1 * fl, 0.25 * fl); }
    if (wu && Wx.rainAll > 0 && WW.camera) wu.rainC.value[3].set(WW.camera.position.x, WW.camera.position.z, 6000, Wx.rainAll);
  }
  // a toon land material (white: its vertex colours carry the albedo)
  function addLand(m) { if (!LAND.includes(m)) LAND.push(m); return m; }
  WW.skyTime = { update, addLand, landK, MOON, wx: () => wx, elev: () => E };
})(window.WW);
