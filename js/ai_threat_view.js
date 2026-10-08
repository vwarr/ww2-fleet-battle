// ai_threat_view.js - debug overlay (key G, off by default, visual only): tints the sea with one side's danger
// field (WW.threat; red = guns / torpedoes, blue = AA umbrella) and marks that side's contact picture
// (WW.intel): a ring at each enemy ship's last-known position, solid while fresh, fading with age. G cycles
// off -> USN picture -> IJN picture -> off. Best with the map camera (key C). Uses Math.random nowhere and
// never touches sim state; it runs its own requestAnimationFrame loop only while it is on.
window.WW = window.WW || {};
(function () {
  'use strict';
  var MAX_RINGS = 48, Y = 0.7;
  var mode = 0, MODES = [null, 'USN', 'IJN'], V = null, lastT = -1, label = null;

  function build() {
    var W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    var f = WW.threat.field('USN'), data = new Uint8Array(f.nx * f.nz * 4);
    var tex = new THREE.DataTexture(data, f.nx, f.nz, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    // grid node (i, j) sits at (i * cell, j * cell): stretch the plane over the nodes' extent
    var ex = (f.nx - 1) * f.cell, ez = (f.nz - 1) * f.cell;
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(ex, ez), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    plane.rotation.x = -Math.PI / 2; plane.position.set(ex / 2, Y, ez / 2); plane.renderOrder = 5;
    // PlaneGeometry v runs +z down after the rotation: flip the texture so row j lands at z = j * cell
    tex.flipY = false; plane.scale.y = -1;
    var ringGeo = new THREE.RingGeometry(0.8, 1, 32), rings = [];
    for (var i = 0; i < MAX_RINGS; i++) {
      var m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 6; rings.push(m);
    }
    var g = new THREE.Group(); g.add(plane); rings.forEach(function (r) { g.add(r); });
    label = document.createElement('div');
    label.style.cssText = 'position:fixed;left:12px;bottom:12px;font:12px/1.3 monospace;color:#fff;background:rgba(0,0,0,.45);padding:4px 8px;border-radius:4px;pointer-events:none;z-index:50;display:none';
    document.body.appendChild(label);
    V = { g: g, tex: tex, data: data, rings: rings, W: W, H: H };
  }

  function paint(nation) {
    var f = WW.threat.field(nation), D = V.data, ref = WW.threat.DREF;
    for (var k = 0; k < f.nx * f.nz; k++) {
      var s = Math.min(1, f.surf[k] / (ref * 2.5)), a = Math.min(1, f.air[k] / 30);
      D[k * 4] = 255; D[k * 4 + 1] = Math.round(120 * (1 - s)); D[k * 4 + 2] = Math.round(200 * a * (1 - s));
      D[k * 4 + 3] = Math.round(255 * Math.min(0.6, s * 0.6 + a * 0.18));
      if (s < 0.02 && a > 0.02) { D[k * 4] = 90; D[k * 4 + 1] = 140; D[k * 4 + 2] = 255; }
    }
    V.tex.needsUpdate = true;
  }

  function frame() {
    if (!mode) return;
    requestAnimationFrame(frame);
    try {
      var nation = MODES[mode], f = WW.threat.field(nation);
      if (f.t !== lastT) { lastT = f.t; paint(nation); }
      var cs = WW.intel ? WW.intel.contacts(nation) : [], now = WW.time.now, n = 0, col = nation === 'USN' ? 0xff6b5b : 0x7fb2ff, fresh = 0;
      for (var i = 0; i < cs.length && n < MAX_RINGS; i++) {
        var c = cs[i], u = c.unit; if (!u || !u.stats || !u.alive) continue;
        var age = now - c.seenAt, r = V.rings[n++], sz = u.stats.length * 0.9 + 4;
        r.visible = true; r.position.set(c.x, Y + 0.1, c.z); r.scale.set(sz, sz, sz);
        r.material.color.setHex(age <= 3 ? col : 0xdddddd); r.material.opacity = age <= 3 ? 0.95 : Math.max(0.12, 0.7 * (1 - age / 90));
        if (age <= 3) fresh++;
      }
      for (; n < MAX_RINGS; n++) V.rings[n].visible = false;
      var B = WW.fleetCmd && WW.fleetCmd.side(nation);
      label.textContent = nation + ' picture: ' + fresh + ' fresh / ' + cs.filter(function (c) { return c.unit && c.unit.stats; }).length + ' contacts' +
        (B ? '  |  posture ' + B.posture + '  ratio ' + B.strength.ratio.toFixed(2) : '') + '   (G: next side / off)';
    } catch (e) { /* visual only */ }
  }

  function toggle() {
    if (!WW.scene || !WW.threat) return;
    if (!V) build();
    mode = (mode + 1) % MODES.length; lastT = -1;
    if (mode) { if (!V.g.parent) WW.scene.add(V.g); label.style.display = 'block'; requestAnimationFrame(frame); }
    else { WW.scene.remove(V.g); label.style.display = 'none'; }
    return MODES[mode];
  }
  window.addEventListener('keydown', function (e) { if (e.key && e.key.toLowerCase() === 'g' && !e.repeat && !WW.plot) toggle(); }); // G belongs to the plot table when it is loaded
  WW.threatView = { toggle: toggle, mode: function () { return MODES[mode]; } };
})();
