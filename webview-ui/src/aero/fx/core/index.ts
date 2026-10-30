// @ts-nocheck
// Vendored, unchanged except this header, from pixelfx (MIT, Copyright (c) 2026 Patch and Hugo Duprez),
// https://github.com/patch-gg/pixelfx at commit fe7103c36d94e02f2d7df7d8f7a341e493837cde. See LICENSE and NOTICE.md here.
// pixelfx core: everything an effect imports comes from here.

export * from "./math.js";
export * from "./color.js";
export * from "./particles.js";
export * from "./shapes.js";
export { Particles, Bits, Lights, Blazes, P, PF, B, GRAVITY, FIRE_RAMP, SMOKE_RAMP, sparkle, flare, band, crystal } from "./sim.js";
export { Painter } from "./painter.js";
export { FONTS, textWidth } from "./font.js";
export { createFrame, clearFrame, createFx, composite, painterFor, resolveOptions } from "./fx.js";
export { stockActor, drawActor, actorAlphaOf, HERO, HERO2, HERO_PAL } from "./actor.js";
