// Disc golf: the words "disc golf" fold into a disc and hop out to a tee.
// Pull back and release to throw. The page is the course, seen from above:
// letters are trees, the screen edges are walls, and the three baskets land
// somewhere new every round. Then everything unfolds again.

import {
  INK,
  GREEN,
  MUTED,
  MONO,
  rand,
  clamp,
  lerp,
  ease,
  easeOutBack,
  easeInOutCubic,
  easeOutCubic,
  createOverlay,
  collectGlyphs,
  drawGlyph,
  circleBox,
  type Glyph,
} from './game-kit';

interface Tree extends Glyph {
  // spring offset when struck
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  shaking: boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; r: number; color: string; t: number; life: number }
interface Ring { x: number; y: number; r0: number; r1: number; t: number; life: number; color: string; w: number }
interface Pop { x: number; y: number; text: string; color: string; size: number; t: number; life: number }
interface Hole { x: number; y: number; par: number }

const DISC_R = 7;
const BASKET_R = 15;
const CATCH_R = 14;
const CATCH_SPEED = 620;
const DRAG_K = 1.1; // speed lost per second, proportional
const DRAG_C = 140; // speed lost per second, constant
const STOP_SPEED = 16;
const FADE = 2.4; // how hard the disc hooks left as it slows
const CURVE_K = 2.6; // how hard a fully shaped throw bends
const MAX_THROWS = 8;
const SPRING_K = 700;
const SPRING_C = 16;

/** Distance a disc released at speed s0 travels before stopping (straight). */
const flightDistance = (s0: number) => s0 / DRAG_K - (DRAG_C / (DRAG_K * DRAG_K)) * Math.log(1 + (DRAG_K * s0) / DRAG_C);

const scoreName = (throws: number, par: number) => {
  if (throws === 1) return 'ace!';
  const d = throws - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double bogey' : `+${d}`;
};

export function startDiscGolf(phrase: HTMLElement, onEnd: () => void) {
  const overlay = createOverlay();
  const { canvas, ctx, W, H, coarse } = overlay;
  canvas.style.cursor = 'crosshair';

  // Freeze the hover tilt so we measure the phrase at rest.
  phrase.dataset.playing = '';
  void phrase.offsetWidth;

  // --- Course -------------------------------------------------------------
  const collected = collectGlyphs(ctx, H);
  const discLetters = collected.glyphs.filter((g) => phrase.contains(g.el));
  const trees: Tree[] = collected.glyphs
    .filter((g) => !phrase.contains(g.el))
    .map((g) => ({ ...g, dx: 0, dy: 0, vx: 0, vy: 0, shaking: false }));
  for (const g of discLetters) g.el.style.visibility = 'hidden';

  const home = {
    x: discLetters.reduce((s, g) => s + g.hx, 0) / Math.max(1, discLetters.length),
    y: discLetters.reduce((s, g) => s + g.hy, 0) / Math.max(1, discLetters.length),
  };

  // Release speed that carries a straight throw most of the way across the
  // screen, so phones and desktops feel the same.
  const reach = Math.hypot(W, H) * 0.8;
  let VMAX = 400;
  for (let lo = 100, hi = 6000, i = 0; i < 30; i++) {
    VMAX = (lo + hi) / 2;
    if (flightDistance(VMAX) < reach) lo = VMAX;
    else hi = VMAX;
  }
  const PULL_MAX = clamp(Math.min(W, H) * 0.3, 90, 170);

  const blocked = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
    for (let i = 1; i < n; i++) {
      const x = lerp(x0, x1, i / n);
      const y = lerp(y0, y1, i / n);
      for (const t of trees) if (circleBox(x, y, DISC_R, t.box)) return true;
    }
    return false;
  };

  const nav = document.getElementById('nav-bar');
  const navBottom = nav?.getBoundingClientRect().bottom ?? H * 0.75;
  const tee = { x: W / 2, y: clamp(navBottom + 64, H * 0.5, H - 80) };

  // Baskets land somewhere new every round: in a clear spot, a fair throw
  // from the last one, and preferably tucked near some text so the letters
  // come into play.
  const nearestText = (x: number, y: number) => {
    let best = Infinity;
    for (const t of trees) {
      const dx = Math.max(t.box.l - x, 0, x - t.box.r);
      const dy = Math.max(t.box.t - y, 0, y - t.box.b);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };
  const HOLES = 3;
  const holes: Hole[] = [];
  const used: { x: number; y: number }[] = [tee];
  const edge = BASKET_R + 14;
  const top = 72; // clear of the HUD
  const bottom = H - 56; // clear of the hint
  let minD = clamp(Math.min(W, H) * 0.3, 110, 320);
  let from = tee;
  for (let i = 0; i < HOLES; i++) {
    let pick: { x: number; y: number; score: number } | null = null;
    for (let tries = 0; tries < 700; tries++) {
      const x = rand(edge, W - edge);
      const y = rand(top, bottom);
      const d = Math.hypot(x - from.x, y - from.y);
      if (d < minD || d > reach * 0.85) continue;
      if (used.some((u) => Math.hypot(x - u.x, y - u.y) < minD * 0.6)) continue;
      const gap = nearestText(x, y);
      if (gap < BASKET_R + 6) continue;
      let score = Math.random();
      if (gap < 70) score += 1; // tucked in by the text
      if (blocked(from.x, from.y, x, y)) score += 0.2; // something to throw around
      if (!pick || score > pick.score) pick = { x, y, score };
    }
    if (!pick) {
      // cramped screen: relax the spacing and try again
      if (minD > 60) {
        minD *= 0.7;
        i--;
      }
      continue;
    }
    const dist = Math.hypot(pick.x - from.x, pick.y - from.y);
    const par = dist < reach * 0.75 && !blocked(from.x, from.y, pick.x, pick.y) ? 2 : 3;
    holes.push({ x: pick.x, y: pick.y, par });
    used.push(pick);
    from = pick;
  }

  // --- State --------------------------------------------------------------
  type State = 'intro' | 'aim' | 'flight' | 'sink' | 'ending';
  let state: State = 'intro';
  let stateT = 0;
  let time = 0;
  let holeIdx = 0;
  let throws = 0;
  let thrown = false;
  const disc = { x: home.x, y: home.y, vx: 0, vy: 0, s0: 1, curve: 0, r: 0, spin: 0, h: 0, sq: 0 };
  const basket = { x: 0, y: 0, scale: 0, target: 0, rattle: 0, caught: false };
  const aim = {
    active: false,
    keyboard: false,
    px: 0,
    py: 0,
    ang: 0,
    power: 0,
    curve: 0, // -1 bends left, +1 bends right
    restPower: 0.5, // what the preview shows before you pull
    restAng: 0,
    mode: 'pull' as 'pull' | 'knob',
    ptr: -1,
    touchedKnob: false,
  };
  // The bend knob rides the preview path; geometry is refreshed every frame.
  const knob = { x: 0, y: 0, scale: 1, visible: false, hover: false };
  const KNOB_HIT = coarse ? 30 : 16;
  let wiggleT = -1;
  const endFrom = { x: 0, y: 0 };
  let hudAlpha = 0;
  let hintAlpha = 0;
  const trail: { x: number; y: number }[] = [];
  const particles: Particle[] = [];
  const rings: Ring[] = [];
  const pops: Pop[] = [];

  const pop = (x: number, y: number, text: string, color = INK, size = 13) =>
    pops.push({ x, y, text, color, size, t: 0, life: 1.1 });

  const hole = () => holes[holeIdx];

  function placeBasket() {
    const h = hole();
    basket.x = h.x;
    basket.y = h.y;
    basket.scale = 0;
    basket.target = 1;
    basket.caught = false;
    basket.rattle = 0;
    throws = 0;
    aim.ang = Math.atan2(h.y - disc.y, h.x - disc.x);
    aim.power = aim.restPower;
    aim.curve = 0;
  }

  // --- Intro --------------------------------------------------------------
  // The letters spiral into a disc, which then hops out of the sentence to
  // a tee in open space.
  const GATHER = 0.32;
  const HOP = 0.5;
  function stepIntro(dt: number) {
    if (stateT < GATHER) {
      const k = stateT / GATHER;
      disc.r = DISC_R * easeOutBack(clamp((k - 0.45) / 0.55, 0, 1), 1.8);
      disc.spin += 18 * dt;
      return;
    }
    const k = clamp((stateT - GATHER) / HOP, 0, 1);
    const e = easeInOutCubic(k);
    disc.r = DISC_R;
    disc.x = lerp(home.x, tee.x, e);
    disc.y = lerp(home.y, tee.y, e);
    disc.h = Math.sin(Math.PI * k);
    disc.spin += 15 * dt;
    if (k >= 1) {
      disc.h = 0;
      disc.sq = 1;
      rings.push({ x: tee.x, y: tee.y, r0: DISC_R, r1: DISC_R + 18, t: 0, life: 0.35, color: MUTED, w: 1 });
      if (!holes.length) return end();
      placeBasket();
      setState('aim');
    }
  }

  function setState(s: State) {
    state = s;
    stateT = 0;
  }

  // --- Input --------------------------------------------------------------
  // Grab the knob on the path and slide it sideways to bend the shot; pull
  // back from anywhere else to throw.
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    if (state !== 'aim' || aim.active) return;
    aim.active = true;
    aim.keyboard = false;
    aim.ptr = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    if (knob.visible && Math.hypot(e.clientX - knob.x, e.clientY - knob.y) < KNOB_HIT) {
      aim.mode = 'knob';
      aim.touchedKnob = true;
      // remember where on the knob it was grabbed, so it doesn't jump
      aim.px = e.clientX - knob.x;
      aim.py = e.clientY - knob.y;
      return;
    }
    aim.mode = 'pull';
    aim.px = e.clientX;
    aim.py = e.clientY;
    aim.restAng = aim.ang;
    aim.power = 0;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!aim.active) {
      const over = knob.visible && Math.hypot(e.clientX - knob.x, e.clientY - knob.y) < KNOB_HIT;
      if (over !== knob.hover) {
        knob.hover = over;
        canvas.style.cursor = over ? 'grab' : 'crosshair';
      }
      return;
    }
    if (e.pointerId !== aim.ptr) return;
    if (aim.mode === 'knob') {
      // The knob follows the finger sideways: find the curve that puts the
      // knob's point of the path that far off the straight line.
      const ux = Math.cos(aim.ang);
      const uy = Math.sin(aim.ang);
      const px = e.clientX - aim.px;
      const py = e.clientY - aim.py;
      const dev = ux * (py - disc.y) - uy * (px - disc.x);
      // measured from where the knob sits with no bend (the natural fade
      // already pulls it a little off the line)
      const d0 = knobDeviation(0);
      const c = dev >= d0 ? (dev - d0) / Math.max(4, knobDeviation(1) - d0) : -(d0 - dev) / Math.max(4, d0 - knobDeviation(-1));
      aim.curve = clamp(c, -1, 1);
      if (Math.abs(aim.curve) < 0.06) aim.curve = 0;
      return;
    }
    // slingshot: drag back, the disc goes the other way
    const dx = aim.px - e.clientX;
    const dy = aim.py - e.clientY;
    const len = Math.hypot(dx, dy);
    aim.power = clamp(len / PULL_MAX, 0, 1);
    if (len > 4) aim.ang = Math.atan2(dy, dx);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!aim.active || e.pointerId !== aim.ptr) return;
    aim.active = false;
    canvas.style.cursor = 'crosshair';
    knob.hover = false;
    if (aim.mode === 'knob') return;
    if (aim.power < 0.06) {
      // a tap or a tiny tug: put the aim back the way it was
      aim.power = aim.restPower;
      aim.ang = aim.restAng;
      return;
    }
    aim.restPower = aim.power;
    release();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return end();
    if (state !== 'aim' || (aim.active && !aim.keyboard)) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      aim.active = true;
      aim.keyboard = true;
      if (e.shiftKey) aim.touchedKnob = true;
      if (k === 'ArrowLeft' && e.shiftKey) aim.curve = clamp(aim.curve - 0.1, -1, 1);
      else if (k === 'ArrowLeft') aim.ang -= 0.06;
      if (k === 'ArrowRight' && e.shiftKey) aim.curve = clamp(aim.curve + 0.1, -1, 1);
      else if (k === 'ArrowRight') aim.ang += 0.06;
      if (k === 'ArrowUp') aim.power = clamp(aim.power + 0.05, 0.05, 1);
      if (k === 'ArrowDown') aim.power = clamp(aim.power - 0.05, 0.05, 1);
    } else if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      aim.active = false;
      aim.restPower = aim.power;
      release();
    }
  };
  const onResize = () => {
    if (window.innerWidth !== W) end();
  };

  function release() {
    const s0 = speedFor(aim.power);
    disc.vx = Math.cos(aim.ang) * s0;
    disc.vy = Math.sin(aim.ang) * s0;
    disc.s0 = s0;
    disc.curve = aim.curve;
    throws++;
    thrown = true;
    trail.length = 0;
    rings.push({ x: disc.x, y: disc.y, r0: DISC_R, r1: DISC_R + 22, t: 0, life: 0.3, color: INK, w: 1.5 });
    setState('flight');
  }

  // --- Flight -------------------------------------------------------------
  function strike(t: Tree, nx: number, ny: number, impact: number) {
    const kick = Math.min(impact * 0.012, 6);
    t.vx -= nx * kick * 18;
    t.vy -= ny * kick * 18;
    if (!t.shaking) {
      t.shaking = true;
      t.el.style.visibility = 'hidden';
    }
    if (impact > 90) {
      const n = impact > 400 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const ang = Math.atan2(ny, nx) + rand(-1, 1);
        const s = rand(60, 120 + impact * 0.25);
        particles.push({
          x: disc.x - nx * DISC_R,
          y: disc.y - ny * DISC_R,
          vx: Math.cos(ang) * s,
          vy: Math.sin(ang) * s,
          r: rand(1, 1.9),
          color: GREEN,
          t: 0,
          life: rand(0.35, 0.6),
        });
      }
    }
  }

  /** Turn and slow the velocity for one step; returns the new speed. */
  function fly(d: { vx: number; vy: number; s0: number; curve: number }, dt: number) {
    const s = Math.hypot(d.vx, d.vy);
    const p = clamp(s / d.s0, 0, 1);
    // The shaped bend (strongest while it's fast), a little high-speed turn
    // right, then the natural fade left as it slows.
    const w = d.curve * CURVE_K * (0.3 + 0.7 * p) + FADE * (0.22 * p * p * p - (1 - p) * (1 - p));
    const c = Math.cos(w * dt);
    const sn = Math.sin(w * dt);
    const vx = d.vx * c - d.vy * sn;
    const vy = d.vx * sn + d.vy * c;
    const ns = Math.max(0, s - (DRAG_K * s + DRAG_C) * dt);
    const f = s > 0 ? ns / s : 0;
    d.vx = vx * f;
    d.vy = vy * f;
    return ns;
  }

  const speedFor = (power: number) => 90 + Math.pow(power, 1.15) * (VMAX - 90);

  /** Where a throw would go in open air (no letters), for the aim preview. */
  function predict(ang: number, power: number, curve: number) {
    const s0 = speedFor(power);
    const d = { vx: Math.cos(ang) * s0, vy: Math.sin(ang) * s0, s0, curve };
    let x = disc.x;
    let y = disc.y;
    const pts = [{ x, y }];
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      const sp = fly(d, dt);
      x += d.vx * dt;
      y += d.vy * dt;
      pts.push({ x, y });
      if (sp < STOP_SPEED) break;
    }
    return pts;
  }

  /** Arc length along the path to the knob, and the points shown. */
  function previewPath(curve: number) {
    const pts = predict(aim.ang, Math.max(aim.power, 0.06), curve);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const show = Math.max(48, total * 0.55);
    return { pts, show, knobAt: Math.max(DISC_R + 26, show * 0.8) };
  }

  function pointAt(pts: { x: number; y: number }[], dist: number) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc + seg >= dist) {
        const k = seg ? (dist - acc) / seg : 0;
        return { x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) };
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }

  /** Signed distance of the knob off the straight aim line (right = +). */
  function knobDeviation(curve: number) {
    const { pts, knobAt } = previewPath(curve);
    const p = pointAt(pts, knobAt);
    const ux = Math.cos(aim.ang);
    const uy = Math.sin(aim.ang);
    return ux * (p.y - disc.y) - uy * (p.x - disc.x);
  }

  function stepFlight(dt: number) {
    const p = clamp(Math.hypot(disc.vx, disc.vy) / disc.s0, 0, 1);
    const s = fly(disc, dt);
    disc.x += disc.vx * dt;
    disc.y += disc.vy * dt;
    disc.h = 4 * p * (1 - p);
    disc.spin += (s / 60) * dt * 6;

    const r = DISC_R;
    const wall = (nx: number, ny: number) => {
      const vn = disc.vx * nx + disc.vy * ny;
      if (vn < 0) {
        disc.vx -= 1.45 * vn * nx;
        disc.vy -= 1.45 * vn * ny;
        disc.sq = Math.min(1, -vn / 500);
      }
    };
    if (disc.x < r) { disc.x = r; wall(1, 0); }
    if (disc.x > W - r) { disc.x = W - r; wall(-1, 0); }
    if (disc.y < r) { disc.y = r; wall(0, 1); }
    if (disc.y > H - r) { disc.y = H - r; wall(0, -1); }

    for (const t of trees) {
      const hit = circleBox(disc.x, disc.y, r, t.box);
      if (!hit) continue;
      const { nx, ny, depth } = hit;
      disc.x += nx * depth;
      disc.y += ny * depth;
      const vn = disc.vx * nx + disc.vy * ny;
      if (vn < 0) {
        // bounce off the normal, scrub some speed along the surface
        const tx = disc.vx - vn * nx;
        const ty = disc.vy - vn * ny;
        disc.vx = tx * 0.82 - vn * 0.38 * nx;
        disc.vy = ty * 0.82 - vn * 0.38 * ny;
        disc.sq = Math.min(1, -vn / 600);
        strike(t, nx, ny, -vn);
      }
    }

    // Chains
    const h = hole();
    const d = Math.hypot(disc.x - h.x, disc.y - h.y);
    if (d < CATCH_R && !basket.caught) {
      const sp = Math.hypot(disc.vx, disc.vy);
      if (sp < CATCH_SPEED) return sink();
      // too hot: spits out, rattling
      basket.rattle = 1;
      const a = Math.atan2(disc.vy, disc.vx) + rand(-0.7, 0.7);
      disc.vx = Math.cos(a) * sp * 0.42;
      disc.vy = Math.sin(a) * sp * 0.42;
      disc.x = h.x + ((disc.x - h.x) / (d || 1)) * CATCH_R;
      disc.y = h.y + ((disc.y - h.y) / (d || 1)) * CATCH_R;
    }

    if (Math.hypot(disc.vx, disc.vy) < STOP_SPEED) {
      disc.vx = disc.vy = 0;
      disc.h = 0;
      if (throws >= MAX_THROWS) {
        pop(disc.x, disc.y - 18, 'picked up', MUTED, 12);
        return sink(true);
      }
      aim.ang = Math.atan2(h.y - disc.y, h.x - disc.x);
      aim.power = aim.restPower;
      aim.curve = 0;
      setState('aim');
    }
  }

  const sinkFrom = { x: 0, y: 0 };
  let pickedUp = false;
  function sink(picked = false) {
    basket.caught = true;
    basket.rattle = 1;
    pickedUp = picked;
    sinkFrom.x = disc.x;
    sinkFrom.y = disc.y;
    disc.vx = disc.vy = 0;
    const h = hole();
    if (!picked) {
      const name = scoreName(throws, h.par);
      const good = throws <= h.par;
      pop(h.x, h.y - BASKET_R - 10, name, good ? GREEN : MUTED, name === 'ace!' ? 16 : 13);
      rings.push({ x: h.x, y: h.y, r0: BASKET_R, r1: BASKET_R + 30, t: 0, life: 0.5, color: good ? GREEN : INK, w: 1.5 });
    }
    setState('sink');
  }

  function stepSink() {
    const h = hole();
    const MOVE = pickedUp ? 0.45 : 0.18;
    const k = clamp(stateT / MOVE, 0, 1);
    const e = easeOutCubic(k);
    disc.x = lerp(sinkFrom.x, h.x, e);
    disc.y = lerp(sinkFrom.y, h.y, e);
    disc.h = pickedUp ? Math.sin(Math.PI * k) * 0.8 : 0;
    if (stateT > 0.95) {
      holeIdx++;
      if (holeIdx >= holes.length) return end();
      // the basket you just sank becomes the next tee
      placeBasket();
      setState('aim');
    }
  }

  // --- Ending -------------------------------------------------------------
  function end() {
    if (state === 'ending') return;
    aim.active = false;
    basket.target = 0;
    endFrom.x = disc.x;
    endFrom.y = disc.y;
    setState('ending');
  }

  const FLY = 0.5;
  const UNFOLD = 0.4;
  function stepEnding(dt: number) {
    if (stateT < FLY) {
      const k = stateT / FLY;
      const e = easeInOutCubic(k);
      disc.x = lerp(endFrom.x, home.x, e);
      disc.y = lerp(endFrom.y, home.y, e);
      disc.h = Math.sin(Math.PI * k) * 0.9;
      disc.r = DISC_R;
      disc.spin += 15 * dt;
      return;
    }
    const k = clamp((stateT - FLY) / UNFOLD, 0, 1);
    disc.x = home.x;
    disc.y = home.y;
    disc.h = 0;
    disc.r = DISC_R * (1 - easeOutCubic(clamp(k / 0.5, 0, 1)));
    const settled = trees.every((t) => !t.shaking);
    if (k >= 1 && settled) cleanup();
  }

  // Letters of the phrase spiral into / out of the disc.
  function phraseProgress(): number {
    // 0 = letters at home, 1 = fully folded into the disc
    if (state === 'intro') return easeInOutCubic(clamp(stateT / GATHER, 0, 1));
    if (state === 'ending') return stateT < FLY ? 1 : 1 - clamp((stateT - FLY) / UNFOLD, 0, 1);
    return 1;
  }

  // --- Springs on struck letters -----------------------------------------
  function stepTrees(dt: number) {
    for (const t of trees) {
      if (!t.shaking) continue;
      t.vx += (-SPRING_K * t.dx - SPRING_C * t.vx) * dt;
      t.vy += (-SPRING_K * t.dy - SPRING_C * t.vy) * dt;
      t.dx += t.vx * dt;
      t.dy += t.vy * dt;
      const lim = 5;
      t.dx = clamp(t.dx, -lim, lim);
      t.dy = clamp(t.dy, -lim, lim);
      if (Math.abs(t.dx) < 0.04 && Math.abs(t.dy) < 0.04 && Math.abs(t.vx) < 1 && Math.abs(t.vy) < 1) {
        t.dx = t.dy = t.vx = t.vy = 0;
        t.shaking = false;
        t.el.style.visibility = '';
      }
    }
  }

  // --- Render -------------------------------------------------------------
  function drawBasket() {
    const s = basket.scale;
    if (s < 0.01) return;
    const { x, y } = basket;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // beacon, so it's easy to find on a busy page
    if (!basket.caught && state !== 'ending') {
      const k = (time % 1.8) / 1.8;
      ctx.globalAlpha = 0.28 * (1 - k);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, BASKET_R + 4 + 16 * easeOutCubic(k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // tray
    ctx.fillStyle = 'rgba(250,250,249,0.92)';
    ctx.strokeStyle = 'rgba(28,25,23,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, BASKET_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // disc resting in the tray
    if (basket.caught) drawDiscBody(0, 0, DISC_R * 0.85, 0);

    // chains
    const n = 10;
    const rat = basket.rattle;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.sin(time * 1.3 + i) * 0.03;
      const jit = rat * 2.2 * Math.sin(time * 48 + i * 2.1);
      const rr = 9 + jit;
      ctx.fillStyle = MUTED;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    // band on top of the pole
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawDiscBody(x: number, y: number, r: number, h: number) {
    if (r < 0.2) return;
    ctx.save();
    ctx.translate(x, y);
    const sc = 1 + 0.38 * h;
    const sq = disc.sq * 0.18;
    ctx.scale(sc * (1 + sq), sc * (1 - sq));
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // flight plate rim + a mark that shows the spin
    ctx.strokeStyle = 'rgba(250,250,249,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(disc.spin);
    ctx.strokeStyle = 'rgba(250,250,249,0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, -0.5, 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    overlay.clear();

    // struck letters wobble on the canvas while their DOM twin hides
    for (const t of trees) if (t.shaking) drawGlyph(ctx, t, t.hx + t.dx, t.hy + t.dy, t.dx * 0.05);

    // the phrase folding into (or out of) the disc
    const pp = phraseProgress();
    if (pp < 1) {
      discLetters.forEach((g, i) => {
        const lag = (Math.abs(i - (discLetters.length - 1) / 2) / discLetters.length) * 0.35;
        const k = clamp((pp - lag) / (1 - lag), 0, 1);
        const x = lerp(g.hx, disc.x, k);
        const y = lerp(g.hy, disc.y, k);
        drawGlyph(ctx, g, x, y, k * 2.4 * (i % 2 ? 1 : -1), 1 - k * k, 1 - 0.7 * k);
      });
    }

    drawBasket();

    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const g of rings) {
      const k = g.t / g.life;
      ctx.globalAlpha = (1 - k) * 0.6;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.w;
      ctx.beginPath();
      ctx.arc(g.x, g.y, lerp(g.r0, g.r1, easeOutCubic(k)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // aim guide: the first stretch of the predicted (open-air) flight with
    // the bend knob riding on it
    knob.visible = false;
    if (state === 'aim') {
      // a little wiggle the first time, so the knob reads as grabbable
      const wig =
        wiggleT >= 0 && !aim.touchedKnob && !aim.active ? 0.45 * Math.sin(wiggleT * 9) * Math.exp(-wiggleT * 2.2) : 0;
      const shownCurve = clamp(aim.curve + wig, -1, 1);
      const { pts, show, knobAt } = previewPath(shownCurve);
      const pulling = aim.active && aim.mode === 'pull';
      const green = pulling && aim.power > 0.97;
      const fadeIn = clamp(stateT / 0.25, 0, 1);

      // straight reference while bending, so you can see how much
      if (aim.curve !== 0 || (aim.active && aim.mode === 'knob')) {
        ctx.globalAlpha = 0.14 * fadeIn;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(disc.x, disc.y);
        ctx.lineTo(disc.x + Math.cos(aim.ang) * knobAt, disc.y + Math.sin(aim.ang) * knobAt);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = green ? GREEN : INK;
      for (let d = DISC_R + 8; d < show; d += 9) {
        if (Math.abs(d - knobAt) < 10) continue;
        const p = pointAt(pts, d);
        ctx.globalAlpha = 0.5 * (1 - (d / show) * 0.85) * fadeIn;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // the knob
      const kp = pointAt(pts, knobAt);
      knob.x = kp.x;
      knob.y = kp.y;
      knob.visible = !pulling && fadeIn > 0.5;
      const target = aim.active && aim.mode === 'knob' ? 1.3 : knob.hover ? 1.15 : 1;
      knob.scale = lerp(knob.scale, target, 0.35);
      const kp2 = pointAt(pts, knobAt + 2);
      const ta = Math.atan2(kp2.y - kp.y, kp2.x - kp.x);
      ctx.save();
      ctx.translate(kp.x, kp.y);
      ctx.rotate(ta);
      ctx.scale(knob.scale, knob.scale);
      ctx.globalAlpha = (pulling ? 0.35 : 1) * fadeIn;
      // side chevrons: slide me this way
      if (!pulling) {
        ctx.strokeStyle = MUTED;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(-2.5, side * 10);
          ctx.lineTo(0, side * 12.5);
          ctx.lineTo(2.5, side * 10);
          ctx.stroke();
        }
      }
      const r = coarse ? 6.5 : 5.5;
      ctx.fillStyle = '#fafaf9';
      ctx.strokeStyle = aim.curve !== 0 ? GREEN : INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (pulling) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = green ? GREEN : INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(disc.x, disc.y, DISC_R + 4 + 10 * (1 - aim.power), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // trail + shadow + disc (hidden while it rests in the basket)
    const inBasket = state === 'sink' && stateT > 0.18 && !pickedUp;
    if (!inBasket) {
      const n = trail.length;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        ctx.fillStyle = `rgba(28,25,23,${0.1 * k})`;
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, DISC_R * (0.3 + 0.5 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      if (disc.h > 0.01 && disc.r > 0.5) {
        ctx.fillStyle = `rgba(28,25,23,${0.1 + 0.06 * (1 - disc.h)})`;
        ctx.beginPath();
        ctx.ellipse(disc.x + 2 + 7 * disc.h, disc.y + 3 + 10 * disc.h, disc.r, disc.r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      let ox = 0;
      let oy = 0;
      if (state === 'aim' && aim.active && aim.mode === 'pull') {
        // wind up: the disc draws back a touch with the pull
        ox = -Math.cos(aim.ang) * aim.power * 5;
        oy = -Math.sin(aim.ang) * aim.power * 5;
      }
      drawDiscBody(disc.x + ox, disc.y + oy, disc.r, disc.h);
    }

    for (const p of pops) {
      const k = p.t / p.life;
      const s = k < 0.18 ? easeOutBack(k / 0.18, 2) : 1;
      ctx.save();
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      ctx.translate(p.x, p.y - 30 * (1 - Math.pow(1 - k, 2)));
      ctx.scale(0.6 + 0.4 * s, 0.6 + 0.4 * s);
      ctx.font = `500 ${p.size}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }

    // HUD
    const pad = W < 640 ? 16 : 28;
    if (hudAlpha > 0.01 && holes.length) {
      const h = holes[Math.min(holeIdx, holes.length - 1)];
      ctx.globalAlpha = hudAlpha;
      ctx.font = `500 12px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#44403c';
      ctx.fillText(`hole ${Math.min(holeIdx + 1, holes.length)}/${holes.length}`, W - pad, pad + 12);
      ctx.fillStyle = MUTED;
      ctx.fillText(`par ${h.par}`, W - pad, pad + 28);
      // one dot per throw on this hole
      for (let i = 0; i < throws; i++) {
        const x = W - pad - 3 - (throws - 1 - i) * 10;
        ctx.fillStyle = i < h.par ? INK : '#d6d3d1';
        ctx.beginPath();
        ctx.arc(x, pad + 40, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (hintAlpha > 0.01) {
      ctx.globalAlpha = hintAlpha;
      ctx.font = `400 ${W < 400 ? 11 : 12}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      const hint = coarse
        ? 'slide the knob to curve  ·  pull back to throw'
        : 'slide the knob to curve  ·  pull back to throw  ·  esc to quit';
      ctx.fillText(hint, W / 2, H - 28);
    }
    ctx.globalAlpha = 1;
  }

  // --- Loop ---------------------------------------------------------------
  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    time += dt;
    stateT += dt;

    hudAlpha = lerp(hudAlpha, state !== 'intro' && state !== 'ending' ? 1 : 0, ease(8, dt));
    hintAlpha = lerp(hintAlpha, state === 'aim' && !thrown ? 1 : 0, ease(thrown ? 12 : 4, dt));
    basket.scale =
      basket.target > basket.scale
        ? Math.min(1, basket.scale + dt / 0.35)
        : Math.max(0, basket.scale - dt / 0.22);
    // ease the spawn with a little overshoot
    const bs = basket.scale;
    basket.rattle = Math.max(0, basket.rattle - dt * 1.6);
    disc.sq = Math.max(0, disc.sq - dt * 9);

    if (state === 'aim' && !thrown && wiggleT < 0 && stateT > 0.5) wiggleT = 0;
    if (wiggleT >= 0) wiggleT += dt;
    if (state === 'intro') stepIntro(dt);
    else if (state === 'flight') {
      const steps = Math.ceil(dt * 240);
      const h = dt / steps;
      for (let i = 0; i < steps && state === 'flight'; i++) stepFlight(h);
      trail.push({ x: disc.x, y: disc.y });
      if (trail.length > 12) trail.shift();
    } else {
      if (trail.length) trail.shift();
      if (state === 'sink') stepSink();
      else if (state === 'ending') stepEnding(dt);
    }

    stepTrees(dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      const k = Math.exp(-5 * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].life) rings.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].t += dt;
      if (pops[i].t >= pops[i].life) pops.splice(i, 1);
    }

    basket.scale = basket.target ? easeOutBack(bs, 1.4) : bs;
    render();
    basket.scale = bs;
    if (raf) raf = requestAnimationFrame(frame);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    overlay.unmount();
    for (const g of collected.glyphs) g.el.style.visibility = '';
    collected.restore();
    // :hover is stale right after the overlay goes; wait for a real move.
    const onMove = () => {
      if (phrase.matches(':hover')) return;
      delete phrase.dataset.playing;
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    onEnd();
  }

  overlay.mount();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);
}
