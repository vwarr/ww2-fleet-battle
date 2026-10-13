// models_german.js - WW.germanModel: the defenders of the Widerstandsnester on screen (visual only). The GI's kit
// (models_soldier.js part / merge / prims) in Feldgrau: trousers in the jackboots, the field blouse with the black
// belt and Y-straps, the bread bag and the fluted gas-mask can on the hip, the Kar 98k, and the Stahlhelm: a dome with
// the flared skirt down over the ears and the neck, the coal-scuttle silhouette that tells a German from a GI at a
// glance across the beach. Merged into one vertex-coloured geometry per pose, drawn with the ships' toon shading:
//   stand        upright, rifle at port arms (a sentry, the man at a casemate's door)
//   aim          leaning on the parapet, the rifle levelled over it (the trench line firing on the beach)
//   gunner       bent low over the MG 42's butt, both hands forward (the MG nest's No. 1)
//   kneel        on one knee, hands down (the loader feeding the belt, the mortar crew at the tube)
//   duck         doubled up below the parapet, head down (a suppressed crew: heads down under fire)
//   runA / runB  the two frames of a crouching run along the trench, rifle in hand
//   fallen       on his back, arms out (a knocked-out position's dead)
// Props (same frame, same colours): mg42 (the bipod gun: barrel jacket with its cooling slots, the receiver, the
// butt, the bipod legs, the belt hanging out of the feed) and mortar (the 8 cm Granatwerfer 34: base plate, tube at 45
// degrees, bipod). Local frame: feet at y = 0, facing +x, ~0.43 u tall (the GI's 2x scale).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const C = { blouse: 0x6c7062, trous: 0x5e6255, helmet: 0x596052, leather: 0x34302b, boot: 0x2b2724, skin: 0xe0b48f,
    bread: 0x7c7559, can: 0x5a6152, stock: 0x7a4f2e, metal: 0x34363a, steel: 0x484b4f, brass: 0xb59a52, plate: 0x50554a };
  const geos = {};
  let flare = null;
  // the figure in a pose: o = { legF, legB (hip swing, + forward), knee (crouch drop), lean (forward), armF (shoulder
  // pitch), rifle: 'port' | 'fwd' | 'none' (hands empty) | 'drop' (beside him, laid flat with the figure) }
  function figure(o) {
    const S = WW.soldierModel, { box, sph, dome, cyl } = S.prims(), part = S.part;
    const P = [], hipY = 0.19 - (o.knee || 0), lean = o.lean || 0, H = hipY;
    for (const [z, sw] of [[0.029, o.legF || 0], [-0.029, o.legB || 0]]) {   // trousers, and the jackboots to mid-calf
      P.push(part(box, C.trous, [0.05, hipY - 0.02, 0.048], [0, (hipY + 0.02) / 2, z], [0, 0, sw], [0, hipY, z]));
      P.push(part(box, C.boot, [0.058, 0.075, 0.052], [0.004, 0.0375, z], [0, 0, sw], [0, hipY, z]));
      P.push(part(box, C.boot, [0.075, 0.025, 0.05], [0.014, 0.0125, z], [0, 0, sw], [0, hipY, z]));
    }
    const up = [];
    up.push(part(box, C.blouse, [0.1, 0.155, 0.13], [0, H + 0.077, 0]));                  // the field blouse
    up.push(part(box, C.blouse, [0.104, 0.03, 0.134], [0, H - 0.005, 0]));                 // ... its skirt over the hips
    up.push(part(box, C.leather, [0.106, 0.018, 0.136], [0, H + 0.015, 0]));                // the black belt
    up.push(part(box, C.leather, [0.012, 0.15, 0.018], [0.05, H + 0.08, 0.03], [0.25, 0, 0])); // the Y-straps
    up.push(part(box, C.leather, [0.012, 0.15, 0.018], [0.05, H + 0.08, -0.03], [-0.25, 0, 0]));
    up.push(part(box, C.leather, [0.03, 0.03, 0.04], [0.05, H + 0.03, 0.04]));              // cartridge pouches
    up.push(part(box, C.leather, [0.03, 0.03, 0.04], [0.05, H + 0.03, -0.04]));
    up.push(part(box, C.bread, [0.06, 0.05, 0.03], [-0.03, H + 0.0, 0.075]));                // the bread bag
    up.push(part(cyl, C.can, [0.034, 0.1, 0.034], [-0.065, H + 0.05, -0.05], [0, 0, 0.15])); // the gas-mask can
    up.push(part(sph, C.skin, [0.08, 0.088, 0.08], [0.008, H + 0.19, 0]));                  // head
    up.push(part(dome, C.helmet, [0.118, 0.085, 0.112], [-0.002, H + 0.206, 0]));           // the Stahlhelm: the dome
    up.push(part(flare, C.helmet, [0.118, 0.05, 0.112], [-0.008, H + 0.186, 0]));           // ... the flared skirt
    up.push(part(box, C.helmet, [0.035, 0.04, 0.1], [-0.05, H + 0.165, 0], [0, 0, -0.35])); // ... down over the neck
    const af = o.armF === undefined ? 0.9 : o.armF;
    for (const z of [0.075, -0.075]) up.push(part(box, C.blouse, [0.04, 0.13, 0.04], [0, H + 0.085, z], [0, 0, af], [0, H + 0.145, z]));
    if (o.rifle === 'port') {          // the Kar 98k across the chest
      up.push(part(box, C.metal, [0.17, 0.012, 0.012], [0.09, H + 0.13, 0], [0.75, 0, 0.4]));
      up.push(part(box, C.stock, [0.13, 0.022, 0.02], [0.04, H + 0.08, -0.02], [0.75, 0, 0.4]));
    } else if (o.rifle === 'fwd') {    // levelled over the parapet
      up.push(part(box, C.metal, [0.2, 0.012, 0.012], [0.19, H + 0.11, 0.02]));
      up.push(part(box, C.stock, [0.14, 0.024, 0.02], [0.05, H + 0.1, 0.02]));
    } else if (o.rifle === 'drop') {
      up.push(part(box, C.metal, [0.012, 0.18, 0.012], [0.0, H + 0.03, 0.14]));
      up.push(part(box, C.stock, [0.02, 0.12, 0.024], [0.0, H - 0.1, 0.14]));
    }
    const pivot = new THREE.Matrix4().makeTranslation(0, H, 0).multiply(new THREE.Matrix4().makeRotationZ(-lean)).multiply(new THREE.Matrix4().makeTranslation(0, -H, 0));
    for (const p of up) p.m = new THREE.Matrix4().multiplyMatrices(pivot, p.m);
    return P.concat(up);
  }
  // the MG 42 on its bipod: muzzle toward +x, the bipod's feet at y = 0 (set on the parapet)
  function mg42() {
    const { box, cyl } = WW.soldierModel.prims(), part = WW.soldierModel.part, P = [];
    const Y = 0.075;
    P.push(part(box, C.steel, [0.2, 0.034, 0.03], [0.09, Y, 0]));                         // the barrel jacket
    for (let i = 0; i < 4; i++) P.push(part(box, C.metal, [0.022, 0.036, 0.032], [0.03 + i * 0.045, Y, 0]));   // its cooling slots
    P.push(part(cyl, C.metal, [0.012, 0.06, 0.012], [0.215, Y, 0], [0, 0, Math.PI / 2]));   // the muzzle booster
    P.push(part(box, C.metal, [0.12, 0.045, 0.036], [-0.06, Y + 0.004, 0]));              // the receiver, the feed cover
    P.push(part(box, C.metal, [0.03, 0.05, 0.016], [-0.075, Y - 0.04, 0], [0, 0, -0.25])); // the pistol grip
    P.push(part(box, C.metal, [0.1, 0.035, 0.026], [-0.165, Y - 0.008, 0], [0, 0, 0.08])); // the butt
    P.push(part(box, C.metal, [0.01, 0.085, 0.01], [0.17, Y / 2, 0.025], [0.35, 0, -0.25]));   // the bipod legs
    P.push(part(box, C.metal, [0.01, 0.085, 0.01], [0.17, Y / 2, -0.025], [-0.35, 0, -0.25]));
    P.push(part(box, C.brass, [0.012, 0.012, 0.09], [-0.05, Y - 0.005, 0.06], [0.5, 0, 0]));   // the belt out of the feed
    P.push(part(box, C.plate, [0.06, 0.045, 0.03], [-0.06, 0.022, 0.12]));                  // an ammunition box
    return WW.soldierModel.merge(P);
  }
  // the 8 cm Granatwerfer 34: the tube pitched up toward +x
  function mortar() {
    const { box, cyl } = WW.soldierModel.prims(), part = WW.soldierModel.part, P = [];
    P.push(part(cyl, C.plate, [0.12, 0.02, 0.12], [-0.04, 0.01, 0]));                       // base plate
    P.push(part(cyl, C.steel, [0.032, 0.24, 0.032], [0.03, 0.09, 0], [0, 0, -0.75]));        // the tube
    P.push(part(box, C.metal, [0.01, 0.12, 0.01], [0.08, 0.055, 0.03], [0.3, 0, 0.15]));     // bipod
    P.push(part(box, C.metal, [0.01, 0.12, 0.01], [0.08, 0.055, -0.03], [-0.3, 0, 0.15]));
    for (let i = 0; i < 3; i++) P.push(part(box, C.plate, [0.05, 0.035, 0.07], [-0.12, 0.018 + i * 0.036, 0.13]));   // the bomb cases
    return WW.soldierModel.merge(P);
  }
  function build() {
    if (geos.stand) return geos;
    const S = WW.soldierModel; S.prims();
    flare = new THREE.CylinderGeometry(0.5, 0.6, 1, 12, 1, true);
    const M = o => S.merge(figure(o));
    geos.stand = M({ armF: 0.9, rifle: 'port' });
    geos.aim = M({ legF: 0.25, legB: -0.15, lean: 0.35, armF: 1.45, rifle: 'fwd' });
    geos.gunner = M({ legF: 0.9, legB: 0.2, knee: 0.07, lean: 0.85, armF: 1.7, rifle: 'none' });
    geos.kneel = M({ legF: 1.2, legB: -0.9, knee: 0.08, lean: 0.4, armF: 0.6, rifle: 'none' });
    geos.duck = M({ legF: 1.3, legB: 0.5, knee: 0.11, lean: 1.15, armF: 2.2, rifle: 'none' });
    geos.runA = M({ legF: 0.6, legB: -0.5, knee: 0.03, lean: 0.5, armF: 0.9, rifle: 'port' });
    geos.runB = M({ legF: -0.5, legB: 0.6, knee: 0.03, lean: 0.5, armF: 0.9, rifle: 'port' });
    const back = new THREE.Matrix4().makeTranslation(0, 0.045, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    geos.fallen = S.merge(figure({ armF: 0.3, legF: 0.2, legB: -0.1, rifle: 'drop' }), back);
    geos.mg42 = mg42();
    geos.mortar = mortar();
    return geos;
  }
  WW.germanModel = { build, COLORS: C, POSES: ['stand', 'aim', 'gunner', 'kneel', 'duck', 'runA', 'runB', 'fallen'] };
})(window.WW);
