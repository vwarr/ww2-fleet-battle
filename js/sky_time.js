// sky_time.js - WW.skyTime: the look of the time of day and the weather (visual only; render mode). sky.update calls
// it every frame. It reads the sim's WW.daylight (daylight.js) and WW.weather (weather.js) and sets the sky dome
// (sun height, palette, stars and moon), the sun / moon light and the sky fill, the fog, the clouds, the water (tint,
// horizon colours, sun or moon glitter path, rain) and the bloom (post.js setNight).
// Keyframes on daylight k: 1 golden hour (the original look, unchanged), 0.7 late sun, 0.45 sunset, 0.25 the blue
// hour, 0 a moonlit night: deep blue but readable, a toy diorama under a cool moon. Rain darkens and greys it.
window.WW = window.WW || {};
(function (WW) {
  const KEYS = [0, 0.25, 0.45, 0.7, 1];
  const C = h => (WW.pastel ? WW.pastel(h, 0.1) : new THREE.Color(h));
  const pal = (...hex) => hex.map(C);
  const PAL = {
    zenith:  pal(0x1d3066, 0x2c3f7c, 0x4e5ca2, 0x3f78cc, 0x3f7fd6),
    sunSide: pal(0x2f4a84, 0x76649c, 0xff9670, 0xffb48a, 0xffc89a),
    away:    pal(0x2a4377, 0x56679f, 0xaea4cc, 0xb4ccee, 0xb4d2f2),
    glow:    pal(0x30498a, 0xb07e9a, 0xffa868, 0xffd2a0, 0xffe0b0),
    fog:     pal(0x2c4476, 0x5a6aa0, 0xbcaed0, 0xc0d8f0, 0xc4dcf2),
    hemiSky: pal(0x7088d0, 0x8a8ccc, 0xe2d2ea, 0xe6ecfa, 0xe6ecfa),
    hemiGnd: pal(0x34406e, 0x4a4a7c, 0xb8a6c8, 0xc4b8d8, 0xc4b8d8),
    light:   pal(0xa4bcff, 0x8890c8, 0xff9a62, 0xffbc86, 0xffc890),
    cloud:   pal(0x404c6e, 0x8c86aa, 0xf2c6b6, 0xeee4e0, 0xeee8e2),
    cloudEm: pal(0x141c34, 0x3c3c6c, 0xb88ab0, 0xb8c4e6, 0xb8c4e6),
    glit:    pal(0xc8d6ff, 0x9098c8, 0xffa070, 0xffcc98, 0xffd2a0)
  };
  const NUM = {
    hemiI:  [0.66, 0.56, 0.62, 0.7, 0.72],
    lightI: [0.62, 0.16, 0.72, 1.05, 1.15],
    tint:   [[0.36, 0.44, 0.68], [0.5, 0.52, 0.74], [0.94, 0.8, 0.82], [0.99, 0.97, 0.97], [1, 1, 1]]
  };
  const RAIN_FOG = C(0x8c98ac), RAIN_CLOUD = C(0x7d8698), MOON_GLIT = new THREE.Color(1.25, 1.3, 1.5);
  const MOON = new THREE.Vector3(0.82, 0.26, -0.5).normalize();   // a low moon (~15 deg) in the east: a long glitter path
  let base = null, az = 0, wx = 0, t = 0, cloudMat = null;
  const domeSun = new THREE.Vector3(), lightDir = new THREE.Vector3(), glitDir = new THREE.Vector3(), tmp = new THREE.Color(), v3 = new THREE.Vector3();

  function seg(k) { let i = 0; while (i < KEYS.length - 2 && k > KEYS[i + 1]) i++; return [i, (k - KEYS[i]) / (KEYS[i + 1] - KEYS[i])]; }
  function col(arr, k, out) { const [i, f] = seg(k); return out.copy(arr[i]).lerp(arr[i + 1], WW.clamp(f, 0, 1)); }
  function num(arr, k) { const [i, f] = seg(k); return WW.lerp(arr[i], arr[i + 1], WW.clamp(f, 0, 1)); }
  function dirAt(out, elevDeg) { const e = elevDeg * Math.PI / 180; return out.set(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)); }
  // the dome's sun: 21 deg at golden hour, 14 at k 0.8, on the horizon at 0.45, 12 deg below at night
  function sunElev(k) { return k >= 0.8 ? 14 + (k - 0.8) / 0.2 * 7 : k >= 0.45 ? (k - 0.45) / 0.35 * 14 : -12 * (0.45 - k) / 0.45; }

  function update(rdt) {
    const P = WW.sky && WW.sky.parts && WW.sky.parts();
    if (!P || !P.dome) return;
    t += rdt || 0;
    if (!base) { base = WW.sky.SUN_DIR.clone(); az = Math.atan2(base.z, base.x); }
    const k = WW.clamp(WW.daylight === undefined ? 1 : WW.daylight, 0, 1), n = 1 - k;
    // weather near what the camera looks at (smoothed, so a cut does not pop the fog)
    let cov = 0;
    if (WW.weather && WW.weather.cells.length && WW.camera) {
      const tg = WW.cam && WW.cam.target ? WW.cam.target() : null;
      cov = Math.max(WW.weather.cover(WW.camera.position.x, WW.camera.position.z) * 0.8, tg ? WW.weather.cover(tg.x, tg.z) : 0);
    }
    wx += (cov - wx) * Math.min(1, (rdt || 0.016) * 1.5);
    const dim = 1 - 0.35 * wx;
    // dome
    const u = P.dome.material.uniforms;
    col(PAL.zenith, k, u.zenith.value); col(PAL.sunSide, k, u.sunSide.value); col(PAL.away, k, u.away.value); col(PAL.glow, k, u.glow.value);
    if (wx > 0.01) { u.zenith.value.lerp(RAIN_FOG, wx * 0.5); u.sunSide.value.lerp(RAIN_FOG, wx * 0.6); u.away.value.lerp(RAIN_FOG, wx * 0.6); }
    dirAt(domeSun, sunElev(k)); u.sunDir.value.copy(domeSun);
    u.night.value = WW.clamp((0.42 - k) / 0.32, 0, 1) * (1 - wx); u.time.value = t;
    u.moonDir.value.copy(MOON);
    // light: the sun (kept 10 deg up for the shadows) until the blue hour, then the moon; the swap happens while dim
    const sd = dirAt(v3, Math.max(10, sunElev(k)));
    const f = WW.clamp((0.35 - k) / 0.1, 0, 1);
    lightDir.copy(sd).lerp(MOON, f).normalize();
    WW.sky.SUN_DIR.copy(lightDir);
    col(PAL.light, k, P.sun.color); P.sun.intensity = num(NUM.lightI, k) * dim;
    col(PAL.hemiSky, k, P.hemi.color); col(PAL.hemiGnd, k, P.hemi.groundColor); P.hemi.intensity = num(NUM.hemiI, k) * (1 - 0.2 * wx);
    // fog and background
    const fog = WW.scene.fog;
    if (fog) {
      col(PAL.fog, k, fog.color);
      if (wx > 0.01) { tmp.copy(RAIN_FOG).multiplyScalar(0.45 + 0.55 * k); fog.color.lerp(tmp, wx * 0.7); fog.near *= 1 - 0.9 * wx; fog.far *= 1 - 0.78 * wx; }
      if (WW.scene.background && WW.scene.background.isColor) WW.scene.background.copy(fog.color);
    }
    // clouds
    if (!cloudMat && P.clouds && P.clouds.children[0]) cloudMat = P.clouds.children[0].children[0].material;
    if (cloudMat) { col(PAL.cloud, k, cloudMat.color); col(PAL.cloudEm, k, cloudMat.emissive); }
    // water
    const wu = WW.water && WW.water.uniforms && WW.water.uniforms();
    if (wu) {
      const tn = NUM.tint, [i, g] = seg(k), gg = WW.clamp(g, 0, 1);
      wu.tint.value.setRGB(WW.lerp(tn[i][0], tn[i + 1][0], gg), WW.lerp(tn[i][1], tn[i + 1][1], gg), WW.lerp(tn[i][2], tn[i + 1][2], gg)).multiplyScalar(1 - 0.18 * wx);
      col(PAL.away, k, wu.hzAway.value); col(PAL.sunSide, k, wu.hzSun.value);
      if (fog && wx > 0.01) { wu.hzAway.value.lerp(fog.color, wx); wu.hzSun.value.lerp(fog.color, wx); }
      if (k > 0.3) { dirAt(glitDir, Math.max(2, sunElev(k))); col(PAL.glit, k, wu.sunCol.value).multiplyScalar(WW.clamp((k - 0.3) / 0.12, 0, 1)); }
      else { glitDir.copy(MOON); wu.sunCol.value.copy(MOON_GLIT).multiplyScalar(WW.clamp((0.3 - k) / 0.18, 0, 1)); }
      wu.sunCol.value.multiplyScalar(1 - 0.85 * wx); wu.sunDir.value.copy(glitDir);   // (merged uniforms are copies)
      const m = WW.clamp((0.35 - k) / 0.3, 0, 1);
      wu.glit.value.set(0.1 - 0.05 * m, 420, 0.35 - 0.25 * m); wu.moonPath.value = m * (1 - wx);
      const cells = WW.weather ? WW.weather.cells : [];
      for (let j = 0; j < 4; j++) { const c = cells[j]; if (c) wu.rainC.value[j].set(c.x, c.z, c.r, c.dens); else wu.rainC.value[j].set(0, 0, 0, 0); }
    }
    if (WW.post && WW.post.setNight) WW.post.setNight(n);
    if (WW.nightFx) WW.nightFx.update(rdt || 0);      // night_fx.js: lights, star shells, searchlights
    if (WW.weatherFx) WW.weatherFx.update(rdt || 0);  // weather_fx.js: rain curtains, cloud decks
  }
  WW.skyTime = { update, MOON, wx: () => wx };
})(window.WW);
