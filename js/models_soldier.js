// models_soldier.js - WW.soldierModel: the GI figure for the Normandy infantry (visual only). The infantry is the heart
// of the land battle, so a soldier has more to him than a sailor: legs and boots, a field jacket with webbing and a
// pack, arms holding an M1 rifle, a face, and the M1 helmet with its brim. Merged by hand into one geometry per pose
// with vertex colours (no BufferGeometryUtils in the UMD build), drawn with the ships' toon shading:
//   runA / runB  the stride's two frames, leaning forward, rifle at port arms (models_infantry.js alternates them)
//   stand        upright, rifle across the chest; crouch: knees bent, bent over (the bluff, the assault)
//   prone        flat on the sand, rifle forward (pinned, the shingle); fallen: on his back, arms out
// Local frame: feet at y = 0, facing +x, ~0.43 u tall (about 2x true size, as the sailors). olive: the uniform colour.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const C = { olive: 0x6f7550, oliveD: 0x5c6243, web: 0x8a8460, helmet: 0x56603f, skin: 0xe2b994, boot: 0x4a3b2c, stock: 0x8a5a34, metal: 0x3a3c3e, pack: 0x7a7a58 };
  const geos = {};
  let box = null, sph = null, dome = null, cyl = null;
  function prim() {
    box = new THREE.BoxGeometry(1, 1, 1);
    sph = new THREE.SphereGeometry(0.5, 8, 6);
    dome = new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  }
  // a part: geometry, colour, size, its centre, rotation (x, y, z), all in the figure's frame; pivot: rotate about this
  // point instead of the centre (limbs swing at the hip and shoulder)
  function part(g, col, s, c, r, pivot) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0));
    if (pivot) {
      const t1 = new THREE.Matrix4().makeTranslation(c[0] - pivot[0], c[1] - pivot[1], c[2] - pivot[2]);
      m.compose(new THREE.Vector3(pivot[0], pivot[1], pivot[2]), q, new THREE.Vector3(1, 1, 1)).multiply(t1).multiply(new THREE.Matrix4().makeScale(s[0], s[1], s[2]));
    } else m.compose(new THREE.Vector3(c[0], c[1], c[2]), q, new THREE.Vector3(s[0], s[1], s[2]));
    return { g, col, m };
  }
  function merge(parts, whole) {
    const pos = [], nor = [], colr = [], v = new THREE.Vector3(), nm = new THREE.Matrix3(), cc = new THREE.Color();
    for (const p of parts) {
      const g = p.g.index ? p.g.toNonIndexed() : p.g, m = whole ? new THREE.Matrix4().multiplyMatrices(whole, p.m) : p.m;
      const pa = g.attributes.position, na = g.attributes.normal;
      nm.getNormalMatrix(m); cc.copy(WW.pastel(p.col, 0.08));
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
        colr.push(cc.r, cc.g, cc.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.computeBoundingSphere();
    return g;
  }
  // the figure in a pose: o = { legF, legB (hip swing, rad: + forward), knee (crouch drop), lean (rad forward),
  // armF (shoulder pitch), rifle ('port' across the chest, 'fwd' pointed ahead, 'none' dropped beside him) }
  function figure(o) {
    const P = [], hipY = 0.19 - (o.knee || 0), lean = o.lean || 0;
    // legs and boots, swinging at the hip (rotation about z: + tips the foot forward along +x)
    for (const [z, sw] of [[0.029, o.legF || 0], [-0.029, o.legB || 0]]) {
      P.push(part(box, C.oliveD, [0.05, hipY - 0.02, 0.048], [0, (hipY + 0.02) / 2, z], [0, 0, sw], [0, hipY, z]));
      P.push(part(box, C.boot, [0.075, 0.035, 0.05], [0.012, 0.0175, z], [0, 0, sw], [0, hipY, z]));
    }
    // the upper body leans forward about the hip
    const up = [], H = hipY;
    up.push(part(box, C.olive, [0.1, 0.15, 0.13], [0, H + 0.075, 0]));                     // field jacket
    up.push(part(box, C.web, [0.105, 0.022, 0.135], [0, H + 0.012, 0]));                   // the cartridge belt
    up.push(part(box, C.web, [0.012, 0.15, 0.02], [0.05, H + 0.075, 0.035]));              // suspenders
    up.push(part(box, C.web, [0.012, 0.15, 0.02], [0.05, H + 0.075, -0.035]));
    up.push(part(box, C.pack, [0.05, 0.085, 0.095], [-0.072, H + 0.1, 0]));               // the assault pack
    up.push(part(sph, C.skin, [0.085, 0.09, 0.085], [0.006, H + 0.19, 0]));                // head
    up.push(part(dome, C.helmet, [0.12, 0.09, 0.115], [0, H + 0.2, 0]));                    // the M1 helmet
    up.push(part(cyl, C.helmet, [0.128, 0.008, 0.122], [0, H + 0.201, 0]));                 // ... and its brim
    const af = o.armF === undefined ? 0.9 : o.armF;
    for (const z of [0.075, -0.075]) up.push(part(box, C.olive, [0.04, 0.13, 0.04], [0, H + 0.085, z], [0, 0, af], [0, H + 0.145, z]));   // arms forward to the rifle
    if (o.rifle === 'none') {  // dropped beside him (laid flat with the figure)
      up.push(part(box, C.metal, [0.014, 0.2, 0.014], [0.0, H + 0.02, 0.13]));
      up.push(part(box, C.stock, [0.02, 0.1, 0.026], [0.0, H - 0.1, 0.13]));
    } else if (o.rifle === 'over') {   // prone: held out beyond the helmet (the figure's +y is ahead once it is laid flat)
      up.push(part(box, C.metal, [0.014, 0.2, 0.014], [0.035, H + 0.33, 0.03]));
      up.push(part(box, C.stock, [0.026, 0.1, 0.02], [0.035, H + 0.2, 0.03]));
    } else if (o.rifle === 'fwd') {   // the rifle pointed ahead (standing, firing)
      up.push(part(box, C.metal, [0.22, 0.014, 0.014], [0.17, H + 0.1, 0.02]));
      up.push(part(box, C.stock, [0.12, 0.026, 0.02], [0.03, H + 0.095, 0.02]));
    } else {                   // port arms: across the chest, muzzle up and to the left
      up.push(part(box, C.metal, [0.2, 0.013, 0.013], [0.08, H + 0.12, 0], [0.75, 0, 0.35]));
      up.push(part(box, C.stock, [0.1, 0.024, 0.02], [0.05, H + 0.07, -0.02], [0.75, 0, 0.35]));
    }
    const pivot = new THREE.Matrix4().makeTranslation(0, H, 0).multiply(new THREE.Matrix4().makeRotationZ(-lean)).multiply(new THREE.Matrix4().makeTranslation(0, -H, 0));
    for (const p of up) p.m = new THREE.Matrix4().multiplyMatrices(pivot, p.m);
    return P.concat(up);
  }
  function build() {
    if (geos.stand) return geos;
    prim();
    geos.stand = merge(figure({ armF: 0.9 }));
    geos.runA = merge(figure({ legF: 0.55, legB: -0.45, lean: 0.25, armF: 0.9 }));
    geos.runB = merge(figure({ legF: -0.45, legB: 0.55, lean: 0.25, armF: 0.9 }));
    geos.crouch = merge(figure({ legF: 0.7, legB: -0.2, knee: 0.06, lean: 0.55, armF: 1.1 }));
    // prone: the standing figure laid flat along +x (head forward), rifle ahead; fallen: on his back, arms out
    const flat = new THREE.Matrix4().makeTranslation(0, 0.045, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-0.0, -0.0, 0));
    geos.prone = merge(figure({ armF: 2.7, rifle: 'over' }), flat);
    const back = new THREE.Matrix4().makeTranslation(0, 0.045, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    geos.fallen = merge(figure({ armF: 0.25, legF: 0.15, legB: -0.1, rifle: 'none' }), back);
    return geos;
  }
  WW.soldierModel = { build, COLORS: C, POSES: ['runA', 'runB', 'stand', 'crouch', 'prone', 'fallen'] };
})(window.WW);
