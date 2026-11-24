// How the landing-page blob leaves into its button and comes back out, as a
// slingshot. Both are pure functions of the time since the button was
// pressed: the blob component samples a pose every frame and draws it, so
// these only describe where things are, not how they're drawn.
//
// - Leaving: it winds up, pulling back from the button, then fires into it.
//   The button catches it (its glyph fills in) and is knocked back.
// - Coming back: the button winds up and fires it out (its glyph empties), and
//   it overshoots and settles before it drifts off.

export interface Pose {
  x: number;                     // blob centre (px)
  y: number;
  scale?: number;                // body size: 1 normal, 0 gone
  tail?: [number, number];       // explicit tail vector (fractions of the radius); omit to trail its motion
  tailMax?: number;              // cap on the trailing tail when it's automatic
  squash?: number;               // >1 stretches along squashAngle, <1 flattens (area kept)
  squashAngle?: number;
  docked: boolean;               // whether the blob is in the button (its glyph filled)
  button?: string;               // CSS transform for the button
  done?: boolean;
  release?: [number, number];    // velocity to roam off with, when coming back
}

export interface Scene {
  fromX: number; fromY: number;  // where the blob was when it was dismissed
  homeX: number; homeY: number;  // where it lands when it comes back
  bx: number; by: number;        // button centre
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const overshoot = (p: number, k = 1.70158) => 1 + (k + 1) * (p - 1) ** 3 + k * (p - 1) ** 2;
// Decaying wobbles: one starts at 0, the other at its full amount.
const wiggle = (t: number, amp: number, hz: number, decay: number) =>
  t <= 0 ? 0 : amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * hz * t);
const spring = (t: number, amp: number, hz: number, decay: number) =>
  t <= 0 ? amp : amp * Math.exp(-decay * t) * Math.cos(2 * Math.PI * hz * t);

const unit = (ax: number, ay: number, bx: number, by: number): [number, number, number] => {
  const d = Math.hypot(bx - ax, by - ay) || 1;
  return [(bx - ax) / d, (by - ay) / d, d];
};

const WIND = 0.24;        // seconds to pull back before firing
const PULL = 30;          // px it pulls back
const KNOCK = 0.65;       // seconds the button rocks after the hit

export const leave = (t: number, s: Scene): Pose => {
  const [ux, uy, d] = unit(s.fromX, s.fromY, s.bx, s.by);
  const angle = Math.atan2(uy, ux);
  const backX = s.fromX - ux * PULL, backY = s.fromY - uy * PULL;
  if (t < WIND) {
    const q = easeOut(t / WIND);
    return { x: lerp(s.fromX, backX, q), y: lerp(s.fromY, backY, q), squash: 1 - 0.2 * q, squashAngle: angle, tail: [0, 0], docked: false };
  }
  const fly = Math.min(0.16 + d / 4500, 0.34);
  const q = clamp01((t - WIND) / fly);
  const hit = t - WIND - fly;
  const knock = wiggle(hit, 9, 2.5, 6);
  return {
    x: lerp(backX, s.bx, q * q),
    y: lerp(backY, s.by, q * q),
    scale: hit > 0 ? 1 - clamp01(hit / 0.07) : 1,
    squash: 0.8 + 0.7 * q,
    squashAngle: angle,
    tailMax: 0.6,
    docked: hit > 0,
    button: hit > 0 ? `translate(${ux * knock}px, ${uy * knock}px) scale(${1 + wiggle(hit, 0.14, 2.5, 6)})` : undefined,
    done: hit > KNOCK,
  };
};

export const back = (t: number, s: Scene): Pose => {
  const [ux, uy] = unit(s.bx, s.by, s.homeX, s.homeY);
  const wind = 0.3;
  if (t < wind) {
    const q = easeOut(t / wind);
    return { x: s.bx, y: s.by, scale: 0, docked: true, button: `translate(${-ux * 5 * q}px, ${-uy * 5 * q}px) scale(${1 - 0.16 * q})` };
  }
  const tau = t - wind;
  const p = clamp01(tau / 0.55);
  const e = overshoot(p, 2);
  const kick = spring(tau, 1, 2.5, 8);
  return {
    x: lerp(s.bx, s.homeX, e),
    y: lerp(s.by, s.homeY, e),
    scale: easeOut(Math.min(p * 4, 1)),
    squash: 1 + 0.7 * (1 - p) ** 3 + wiggle(tau - 0.3, 0.08, 3, 7),
    squashAngle: Math.atan2(uy, ux),
    tailMax: 0.6,
    docked: false,
    button: `translate(${-ux * 5 * kick}px, ${-uy * 5 * kick}px) scale(${1 - 0.16 * kick})`,
    done: p >= 1,
    release: [ux * 150, uy * 150],
  };
};
