# Speed and size calibration (speedcal, 2026-10-19)

## Scale (shared with gunnery)

- **Length: 1 u = 9.6 m (`WW.cfg.U_PER_M` = 0.104 u/m).** From `WW.cfg.L` = 26 u for a ~250 m carrier hull
  (ship_classes.js). The map, the ships and the planes use the same metre: an F4F's 11.6 m span is 1.2 u at
  `PLANE_SCALE` 0.41; the plane models are lofted at ~0.245 model units per metre, so 0.245 x 0.41 = 0.100 u/m
  (within 4% of the ships' 0.104). The weapons hung under them (Mk 13 4.1 m, Type 91 5.3 m, AN-M65 1.75 m, the
  Val's 250 kg 1.9 m) come out within 5% of their real sizes.
- **Altitude is not linear:** `y = 0.4 * h_real[m]^0.59` u (core.js `WW.altOf`; 15 m -> 2 u, 600 m -> 18 u,
  4,500 m -> 58 u). Near the sea a game unit of height is ~3x a metre's share of a horizontal unit.
- **Time.** Sim speeds are written on the **ship clock**: 1 u/s = 5.71 kn of real speed (a carrier's 32 kn =
  5.6 u/s; torpedoes and planes are on the same clock). At 1x the screen shows `BASE_SPEED` 0.5 sim s per real
  second, so 1 u/s of sim speed moves 4.8 m per real second = **9.33 kn on screen**. Everything on the ship clock
  therefore shows at **1.63x its real speed at 1x** (9.33 / 5.71); at 2x it is 3.27x, at 4x 6.5x.
- Gravity: bombs fall at 9.8 u/s^2 sim = 23.5 m/s^2 on screen at 1x, which is what 1 g looks like on a 1.63x
  clock (9.8 x 1.63^2 = 26 m/s^2) within 10%.
- Conversions: on-screen kn at 1x = sim u/s x 9.33; real (ship-clock) kn = sim u/s x 5.71; on-screen m/s at 1x
  = sim u/s x 4.8.
