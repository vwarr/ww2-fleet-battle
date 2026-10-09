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
  const MOON = new THREE.Vector3(0.82, 0.26, -0.5).normalize();   // a low moon (~15 deg) in the east: a long glitter path
  let wx = 0, t = 0, cloudMat = null;
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
    if (WW.weather && WW.weather.cells.length && WW.camera) {
      const tg = WW.cam && WW.cam.target ? WW.cam.target() : null;
      cov = Math.max(WW.weather.cover(WW.camera.position.x, WW.camera.position.z) * 0.8, tg ? WW.weather.cover(tg.x, tg.z) : 0);
    }
    wx += (cov - wx) * Math.min(1, (rdt || 0.016) * 1.5);
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
    // fog and background
    const fog = WW.scene.fog;
    if (fog) {
      col('fog', fog.color);
      if (wx > 0.01) { tmp.copy(RAIN_FOG).multiplyScalar(0.45 + 0.55 * k); fog.color.lerp(tmp, wx * 0.7); fog.near *= 1 - 0.9 * wx; fog.far *= 1 - 0.78 * wx; }
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
    // bloom: night, and a warm glow round a low sun
    const golden = E > -3 ? WW.clamp((12 - E) / 10, 0, 1) : 0;
    if (WW.post && WW.post.setNight) WW.post.setNight(Math.max(n, 0.5 * golden));
    if (WW.nightFx) WW.nightFx.update(rdt || 0);      // night_fx.js: lights, star shells, searchlights
    if (WW.weatherFx) WW.weatherFx.update(rdt || 0);  // weather_fx.js: rain curtains, cloud decks
  }
  WW.skyTime = { update, MOON, wx: () => wx, elev: () => E };
})(window.WW);
