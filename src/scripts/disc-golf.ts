// Disc golf, side view: the words "disc golf" fold into a disc that hops
// down to a tee on the ground. Pull back and let go to throw. The disc glides
// on its forward speed and drops when it slows, so low throws skim far and
// high throws loft over things. Letters are solid: the disc bounces off them,
// skips along them and can come to rest on top of a word. Three baskets
// stand somewhere new every round, on a word or on the ground.

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
  type Box,
  type Glyph,
} from './game-kit';

interface Tree extends Glyph {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  shaking: boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; r: number; color: string; t: number; life: number }
interface Ring { x: number; y: number; r0: number; r1: number; t: number; life: number; color: string; w: number }
interface Pop { x: number; y: number; text: string; color: string; size: number; t: number; life: number }
interface Hole { x: number; y: number; par: number } // y is the surface the basket stands on

const DISC_W = 8; // half width of the disc seen edge-on
const DISC_H = 3; // half height
const HIT_R = 5; // collision radius
const MAX_THROWS = 8;
const SPRING_K = 700;
const SPRING_C = 16;

// Basket, side on, relative to the surface it stands on
const BK = { h: 40, half: 13, trayTop: 16, trayBot: 10, trayHalf: 10 };

const scoreName = (throws: number, par: number) => {
  if (throws === 1) return 'ace!';
  const d = throws - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double bogey' : `+${d}`;
};

export function startDiscGolf(phrase: HTMLElement, onEnd: () => void) {
  // Freeze the hover tilt so we measure the phrase at rest.
  phrase.dataset.playing = '';
  void phrase.offsetWidth;

  const overlay = createOverlay();
  const { canvas, ctx, W, H, coarse } = overlay;
  canvas.style.cursor = 'crosshair';

  // World scale, so a phone plays like a desktop, just smaller.
  const k = clamp(Math.hypot(W, H) / 1250, 0.6, 1.3);
  const G = 1500 * k;
  const LIFT = 0.0016 / k; // lift per (horizontal speed)^2
  const LIFT_MAX = 0.9; // never quite cancels gravity
  const DRAG = 0.00035 / k;
  const DRAG_LIN = 0.25;
  const VMAX = 1450 * k;
  const VMIN = 260 * k;
  const CATCH_SPEED = 750 * k;
  const REST_SPEED = 28 * k;
  const PULL_MAX = clamp(Math.min(W, H) * 0.3, 90, 170);
  const GROUND = H - 44;

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

  const clearRect = (b: Box) => !trees.some((t) => t.box.r > b.l && t.box.l < b.r && t.box.b > b.t && t.box.t < b.b);

  // Places a basket can stand: on top of a word with open air above it, or
  // on the ground.
  const spots: { x: number; y: number; onWord: boolean }[] = [];
  for (const w of collected.words) {
    const gs = w.glyphs.filter((g) => !g.img && !phrase.contains(g.el));
    if (gs.length < 3) continue;
    const top = Math.min(...gs.map((g) => g.box.t));
    const l = Math.min(...gs.map((g) => g.box.l));
    const r = Math.max(...gs.map((g) => g.box.r));
    const x = (l + r) / 2;
    if (x < 28 || x > W - 28 || top - BK.h - 8 < 64) continue;
    if (!clearRect({ l: x - BK.half - 4, r: x + BK.half + 4, t: top - BK.h - 6, b: top - 1 })) continue;
    spots.push({ x, y: top, onWord: true });
  }
  for (let i = 0; i < 12; i++) spots.push({ x: rand(32, W - 32), y: GROUND, onWord: false });

  const tee = { x: Math.random() < 0.5 ? W * 0.14 : W * 0.86, y: GROUND - DISC_H };

  const holes: Hole[] = [];
  {
    const minD = clamp(Math.min(W, H) * 0.3, 110, 320);
    let from = { x: tee.x, y: GROUND };
    const used: { x: number; y: number }[] = [from];
    for (let i = 0; i < 3; i++) {
      let pick: { x: number; y: number; score: number } | null = null;
      for (const s of spots) {
        const d = Math.hypot(s.x - from.x, s.y - from.y);
        if (d < minD) continue;
        if (used.some((u) => Math.hypot(s.x - u.x, s.y - u.y) < minD * 0.6)) continue;
        const score = Math.random() + (s.onWord ? 0.7 : 0);
        if (!pick || score > pick.score) pick = { ...s, score };
      }
      if (!pick) break;
      const d = Math.hypot(pick.x - from.x, pick.y - from.y);
      const par = d > W * 0.55 || pick.y < from.y - 160 ? 3 : 2;
      holes.push({ x: pick.x, y: pick.y, par });
      used.push(pick);
      from = pick;
    }
  }

  // --- State --------------------------------------------------------------
  type State = 'intro' | 'aim' | 'flight' | 'sink' | 'ending';
  let state: State = 'intro';
  let stateT = 0;
  let time = 0;
  let holeIdx = 0;
  let throws = 0;
  let thrown = false;
  const disc = { x: home.x, y: home.y, vx: 0, vy: 0, scale: 0, pitch: 0, spin: 0, sq: 0, still: 0, airT: 0 };
  const basket = { scale: 0, target: 0, rattle: 0, caught: false };
  const aim = { active: false, keyboard: false, px: 0, py: 0, ang: -0.5, power: 0, ptr: -1, restAng: -0.5 };
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

  function setState(s: State) {
    state = s;
    stateT = 0;
  }

  /** A sensible default aim: up and toward the basket. */
  function defaultAim() {
    const h = hole();
    aim.ang = h.x >= disc.x ? -0.6 : Math.PI + 0.6;
    aim.power = 0.55;
  }

  function placeBasket() {
    basket.scale = 0;
    basket.target = 1;
    basket.caught = false;
    basket.rattle = 0;
    throws = 0;
    defaultAim();
  }

  // --- Intro --------------------------------------------------------------
  const GATHER = 0.32;
  const HOP = 0.55;
  function stepIntro(dt: number) {
    disc.spin += 16 * dt;
    if (stateT < GATHER) {
      disc.scale = easeOutBack(clamp((stateT / GATHER - 0.45) / 0.55, 0, 1), 1.8);
      return;
    }
    const t = clamp((stateT - GATHER) / HOP, 0, 1);
    disc.scale = 1;
    disc.x = lerp(home.x, tee.x, easeInOutCubic(t));
    disc.y = lerp(home.y, tee.y, t * t) - Math.sin(Math.PI * t) * 70;
    disc.pitch = (tee.x > home.x ? 1 : -1) * Math.sin(Math.PI * t) * 0.4;
    if (t >= 1) {
      disc.x = tee.x;
      disc.y = tee.y;
      disc.pitch = 0;
      disc.sq = 1;
      dust(disc.x, GROUND, 4);
      if (!holes.length) return end();
      placeBasket();
      setState('aim');
    }
  }

  // --- Input --------------------------------------------------------------
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    if (state !== 'aim' || aim.active) return;
    aim.active = true;
    aim.keyboard = false;
    aim.ptr = e.pointerId;
    aim.px = e.clientX;
    aim.py = e.clientY;
    aim.restAng = aim.ang;
    aim.power = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!aim.active || e.pointerId !== aim.ptr) return;
    // slingshot: pull back, the disc goes the other way
    const dx = aim.px - e.clientX;
    const dy = aim.py - e.clientY;
    const len = Math.hypot(dx, dy);
    aim.power = clamp(len / PULL_MAX, 0, 1);
    if (len > 6) aim.ang = Math.atan2(dy, dx);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!aim.active || e.pointerId !== aim.ptr) return;
    aim.active = false;
    canvas.style.cursor = 'crosshair';
    if (aim.power < 0.08) {
      // a tap or a tiny tug: put the aim back
      aim.ang = aim.restAng;
      aim.power = 0;
      return;
    }
    release();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return end();
    if (state !== 'aim' || (aim.active && !aim.keyboard)) return;
    const key = e.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      if (!aim.keyboard) aim.power = Math.max(aim.power, 0.55);
      aim.active = true;
      aim.keyboard = true;
      // left/right tip the aim lower/higher on the side you face
      const facing = Math.cos(aim.ang) >= 0 ? 1 : -1;
      if (key === 'ArrowLeft') aim.ang -= 0.05 * facing;
      if (key === 'ArrowRight') aim.ang += 0.05 * facing;
      if (key === 'ArrowUp') aim.power = clamp(aim.power + 0.05, 0.1, 1);
      if (key === 'ArrowDown') aim.power = clamp(aim.power - 0.05, 0.1, 1);
    } else if (key === ' ' || key === 'Enter') {
      e.preventDefault();
      if (!aim.keyboard) aim.power = Math.max(aim.power, 0.55);
      aim.active = false;
      release();
    }
  };
  const onResize = () => {
    if (window.innerWidth !== W) end();
  };

  const speedFor = (power: number) => lerp(VMIN, VMAX, Math.pow(power, 1.1));

  function release() {
    const s0 = speedFor(aim.power);
    disc.vx = Math.cos(aim.ang) * s0;
    disc.vy = Math.sin(aim.ang) * s0;
    disc.still = 0;
    disc.airT = 0;
    throws++;
    thrown = true;
    trail.length = 0;
    aim.keyboard = false;
    rings.push({ x: disc.x, y: disc.y, r0: DISC_W, r1: DISC_W + 20, t: 0, life: 0.3, color: INK, w: 1.5 });
    setState('flight');
  }

  // --- Flight -------------------------------------------------------------
  /** Gravity, glide and drag for one step (open air). */
  function air(d: { vx: number; vy: number }, dt: number) {
    const s = Math.hypot(d.vx, d.vy);
    const lift = Math.min(G * LIFT_MAX, LIFT * d.vx * d.vx);
    d.vx += (-DRAG * s * d.vx - DRAG_LIN * d.vx) * dt;
    d.vy += (G - lift - DRAG * s * d.vy - DRAG_LIN * d.vy) * dt;
  }

  /** Where a throw would go in open air, for the aim preview. */
  function predict(ang: number, power: number) {
    const s0 = speedFor(power);
    const d = { vx: Math.cos(ang) * s0, vy: Math.sin(ang) * s0 };
    let x = disc.x;
    let y = disc.y;
    const pts = [{ x, y }];
    const dt = 1 / 60;
    for (let i = 0; i < 400; i++) {
      air(d, dt);
      x += d.vx * dt;
      y += d.vy * dt;
      pts.push({ x, y });
      if (y > GROUND || x < -50 || x > W + 50) break;
    }
    return pts;
  }

  function dust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x,
        y,
        vx: rand(-90, 90) * k,
        vy: rand(-140, -40) * k,
        r: rand(0.8, 1.6),
        color: MUTED,
        t: 0,
        life: rand(0.3, 0.5),
      });
    }
  }

  function strike(t: Tree, nx: number, ny: number, impact: number) {
    const kick = Math.min(impact * 0.01, 5);
    t.vx -= nx * kick * 18;
    t.vy -= ny * kick * 18;
    if (!t.shaking) {
      t.shaking = true;
      t.el.style.visibility = 'hidden';
    }
    if (impact > 120 * k) {
      const n = impact > 500 * k ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(ny, nx) + rand(-1, 1);
        const s = rand(60, 110 + impact * 0.2);
        particles.push({
          x: disc.x - nx * HIT_R,
          y: disc.y - ny * HIT_R,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          r: rand(1, 1.8),
          color: GREEN,
          t: 0,
          life: rand(0.4, 0.7),
        });
      }
    }
  }

  // Solid parts of the basket (band, pole, tray floor) the disc can clang off.
  function basketSolids(): Box[] {
    const h = hole();
    return [
      { l: h.x - BK.half, r: h.x + BK.half, t: h.y - BK.h - 3, b: h.y - BK.h + 1 },
      { l: h.x - 1.5, r: h.x + 1.5, t: h.y - BK.h, b: h.y - BK.trayTop },
      { l: h.x - BK.trayHalf, r: h.x + BK.trayHalf, t: h.y - BK.trayBot, b: h.y - BK.trayBot + 3 },
      { l: h.x - 1.5, r: h.x + 1.5, t: h.y - BK.trayBot, b: h.y },
    ];
  }

  function stepFlight(dt: number) {
    air(disc, dt);
    disc.x += disc.vx * dt;
    disc.y += disc.vy * dt;
    disc.airT += dt;
    let contact = false;

    const r = HIT_R;
    const bounce = (nx: number, ny: number, depth: number, rest: number, fric: number) => {
      disc.x += nx * depth;
      disc.y += ny * depth;
      const vn = disc.vx * nx + disc.vy * ny;
      if (vn < 0) {
        const tx = disc.vx - vn * nx;
        const ty = disc.vy - vn * ny;
        disc.vx = tx * fric - vn * rest * nx;
        disc.vy = ty * fric - vn * rest * ny;
        disc.sq = Math.min(1, -vn / (500 * k));
        return -vn;
      }
      return 0;
    };

    // Ground: skips on a shallow landing, then slides to a stop.
    if (disc.y > GROUND - DISC_H) {
      const impact = bounce(0, -1, disc.y - (GROUND - DISC_H), 0.28, 0.86);
      if (impact > 160 * k) dust(disc.x, GROUND, impact > 500 * k ? 5 : 2);
      contact = true;
    }
    if (disc.x < r) bounce(1, 0, r - disc.x, 0.4, 0.9);
    if (disc.x > W - r) bounce(-1, 0, disc.x - (W - r), 0.4, 0.9);
    if (disc.y < -H) disc.y = -H;

    for (const t of trees) {
      const hit = circleBox(disc.x, disc.y, r, t.box);
      if (!hit) continue;
      const impact = bounce(hit.nx, hit.ny, hit.depth, 0.32, 0.8);
      if (impact > 0) strike(t, hit.nx, hit.ny, impact);
      if (hit.ny < -0.5) contact = true;
    }

    const h = hole();
    for (const b of basketSolids()) {
      const hit = circleBox(disc.x, disc.y, r, b);
      if (!hit) continue;
      const impact = bounce(hit.nx, hit.ny, hit.depth, 0.35, 0.85);
      if (impact > 200 * k) basket.rattle = Math.max(basket.rattle, 0.5);
      if (hit.ny < -0.5) contact = true;
    }

    // Chains: the open cage between the band and the tray.
    const inCage = Math.abs(disc.x - h.x) < BK.half && disc.y > h.y - BK.h + 2 && disc.y < h.y - BK.trayTop + 2;
    if (inCage && !basket.caught) {
      const sp = Math.hypot(disc.vx, disc.vy);
      if (sp < CATCH_SPEED) return sink();
      // too hot: the chains knock it back out
      basket.rattle = 1;
      const side = disc.vx > 0 ? -1 : 1;
      disc.x = h.x + side * (BK.half + r);
      disc.vx = side * Math.abs(disc.vx) * 0.25;
      disc.vy *= 0.3;
    }

    // Resting contact: friction, then stop.
    if (contact) disc.vx *= Math.exp(-4 * dt);
    const sp = Math.hypot(disc.vx, disc.vy);
    disc.still = contact && sp < REST_SPEED ? disc.still + dt : 0;
    if (disc.still > 0.15 || disc.airT > 9) {
      disc.vx = disc.vy = 0;
      if (throws >= MAX_THROWS) {
        pop(disc.x, disc.y - 18, 'picked up', MUTED, 12);
        return sink(true);
      }
      defaultAim();
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
      pop(h.x, h.y - BK.h - 14, name, good ? GREEN : MUTED, name === 'ace!' ? 16 : 13);
      rings.push({ x: h.x, y: h.y - BK.h / 2, r0: 14, r1: 44, t: 0, life: 0.5, color: good ? GREEN : INK, w: 1.5 });
    }
    setState('sink');
  }

  function stepSink() {
    const h = hole();
    const MOVE = pickedUp ? 0.45 : 0.16;
    const t = clamp(stateT / MOVE, 0, 1);
    disc.x = lerp(sinkFrom.x, h.x, easeOutCubic(t));
    disc.y = lerp(sinkFrom.y, h.y - BK.trayTop + 1, t * t) - (pickedUp ? Math.sin(Math.PI * t) * 40 : 0);
    if (stateT > 0.95) {
      holeIdx++;
      if (holeIdx >= holes.length) {
        disc.x = h.x;
        disc.y = h.y - BK.trayTop + 1;
        return end();
      }
      // the basket you just sank becomes the next tee: step out beside it
      const side = holes[holeIdx].x >= h.x ? 1 : -1;
      disc.x = clamp(h.x + side * (BK.half + 10), 12, W - 12);
      disc.y = h.y - DISC_H;
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

  const FLY = 0.55;
  const UNFOLD = 0.4;
  function stepEnding(dt: number) {
    disc.spin += 16 * dt;
    if (stateT < FLY) {
      const t = stateT / FLY;
      disc.x = lerp(endFrom.x, home.x, easeInOutCubic(t));
      disc.y = lerp(endFrom.y, home.y, easeInOutCubic(t)) - Math.sin(Math.PI * t) * 60;
      disc.pitch = (home.x > endFrom.x ? 1 : -1) * Math.sin(Math.PI * t) * 0.3;
      disc.scale = 1;
      return;
    }
    const t = clamp((stateT - FLY) / UNFOLD, 0, 1);
    disc.x = home.x;
    disc.y = home.y;
    disc.pitch = 0;
    disc.scale = 1 - easeOutCubic(clamp(t / 0.5, 0, 1));
    if (t >= 1 && trees.every((tr) => !tr.shaking)) cleanup();
  }

  function phraseProgress(): number {
    if (state === 'intro') return easeInOutCubic(clamp(stateT / GATHER, 0, 1));
    if (state === 'ending') return stateT < FLY ? 1 : 1 - clamp((stateT - FLY) / UNFOLD, 0, 1);
    return 1;
  }

  function stepTrees(dt: number) {
    for (const t of trees) {
      if (!t.shaking) continue;
      t.vx += (-SPRING_K * t.dx - SPRING_C * t.vx) * dt;
      t.vy += (-SPRING_K * t.dy - SPRING_C * t.vy) * dt;
      t.dx = clamp(t.dx + t.vx * dt, -5, 5);
      t.dy = clamp(t.dy + t.vy * dt, -5, 5);
      if (Math.abs(t.dx) < 0.04 && Math.abs(t.dy) < 0.04 && Math.abs(t.vx) < 1 && Math.abs(t.vy) < 1) {
        t.dx = t.dy = t.vx = t.vy = 0;
        t.shaking = false;
        t.el.style.visibility = '';
      }
    }
  }

  // --- Render -------------------------------------------------------------
  function drawDisc(x: number, y: number, scale: number, pitch: number) {
    if (scale < 0.02) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pitch);
    const sq = disc.sq * 0.25;
    ctx.scale(scale * (1 + sq), scale * (1 - sq));
    // edge-on disc: a shallow dome over a flat rim
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(0, 0, DISC_W, DISC_H, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -DISC_H * 0.35, DISC_W * 0.72, DISC_H * 1.05, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // a glint that slides across as it spins
    const g = Math.sin(disc.spin);
    ctx.strokeStyle = 'rgba(250,250,249,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g * DISC_W * 0.55 - 1.5, -DISC_H * 0.9);
    ctx.lineTo(g * DISC_W * 0.55 + 1.5, -DISC_H * 0.9);
    ctx.stroke();
    ctx.restore();
  }

  function drawBasket() {
    if (!holes.length) return;
    const s = basket.scale;
    if (s < 0.01) return;
    const h = holes[Math.min(holeIdx, holes.length - 1)];
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.scale(s, s);

    // beacon
    if (!basket.caught && state !== 'ending') {
      const t = (time % 1.8) / 1.8;
      ctx.globalAlpha = 0.25 * (1 - t);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, -BK.h / 2, 24 + 16 * easeOutCubic(t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = 'rgba(28,25,23,0.7)';
    ctx.lineCap = 'round';
    // pole and foot
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -BK.h);
    ctx.moveTo(-6, 0);
    ctx.lineTo(6, 0);
    ctx.stroke();
    // tray
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-BK.half, -BK.trayTop);
    ctx.lineTo(-BK.trayHalf, -BK.trayBot);
    ctx.lineTo(BK.trayHalf, -BK.trayBot);
    ctx.lineTo(BK.half, -BK.trayTop);
    ctx.stroke();

    // a caught disc sits in the tray, behind the chains
    if (basket.caught && state === 'sink' && stateT > 0.16 && !pickedUp) drawDisc(0, -BK.trayTop + 2, 0.9, 0);

    // chains
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 1;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5;
      const sway = basket.rattle * 2.5 * Math.sin(time * 40 + i * 1.7);
      ctx.beginPath();
      ctx.moveTo(u * 2 * (BK.half - 2), -BK.h + 2);
      ctx.quadraticCurveTo(u * 2 * (BK.half - 1) + sway, -(BK.h + BK.trayTop) / 2, u * 8 + sway * 0.4, -BK.trayTop - 2);
      ctx.stroke();
    }
    // top band
    ctx.fillStyle = GREEN;
    ctx.fillRect(-BK.half, -BK.h - 3, BK.half * 2, 3.5);
    ctx.restore();
  }

  function render() {
    overlay.clear();

    // ground line
    if (hudAlpha > 0.01) {
      ctx.globalAlpha = 0.5 * hudAlpha;
      ctx.fillStyle = MUTED;
      for (let x = 4; x < W; x += 7) ctx.fillRect(x, GROUND, 2.5, 1);
      ctx.globalAlpha = 1;
    }

    for (const t of trees) if (t.shaking) drawGlyph(ctx, t, t.hx + t.dx, t.hy + t.dy, t.dx * 0.05);

    const pp = phraseProgress();
    if (pp < 1) {
      discLetters.forEach((g, i) => {
        const lag = (Math.abs(i - (discLetters.length - 1) / 2) / discLetters.length) * 0.35;
        const t = clamp((pp - lag) / (1 - lag), 0, 1);
        drawGlyph(ctx, g, lerp(g.hx, disc.x, t), lerp(g.hy, disc.y, t), t * 2.4 * (i % 2 ? 1 : -1), 1 - t * t, 1 - 0.7 * t);
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
      const t = g.t / g.life;
      ctx.globalAlpha = (1 - t) * 0.6;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.w;
      ctx.beginPath();
      ctx.arc(g.x, g.y, lerp(g.r0, g.r1, easeOutCubic(t)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // aim: band back to a handle, and the start of the flight arc
    if (state === 'aim' && (aim.active || aim.keyboard) && aim.power > 0.02) {
      const green = aim.power > 0.97;
      const pts = predict(aim.ang, aim.power);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const show = Math.max(40, total * 0.5);
      ctx.fillStyle = green ? GREEN : INK;
      let acc = 0;
      let next = DISC_W + 8;
      for (let i = 1; i < pts.length && next < show; i++) {
        const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        while (next <= acc + seg && next < show) {
          const f = seg ? (next - acc) / seg : 0;
          ctx.globalAlpha = 0.55 * (1 - (next / show) * 0.85);
          ctx.beginPath();
          ctx.arc(lerp(pts[i - 1].x, pts[i].x, f), lerp(pts[i - 1].y, pts[i].y, f), 1.6, 0, Math.PI * 2);
          ctx.fill();
          next += 9;
        }
        acc += seg;
      }
      if (!aim.keyboard) {
        const bx = -Math.cos(aim.ang);
        const by = -Math.sin(aim.ang);
        const m = 10;
        let L = aim.power * PULL_MAX;
        if (bx > 0) L = Math.min(L, (W - m - disc.x) / bx);
        if (bx < 0) L = Math.min(L, (m - disc.x) / bx);
        if (by > 0) L = Math.min(L, (H - m - disc.y) / by);
        if (by < 0) L = Math.min(L, (m - disc.y) / by);
        L = Math.max(DISC_W + 10, L);
        const ex = disc.x + bx * L;
        const ey = disc.y + by * L;
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = green ? GREEN : INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(disc.x, disc.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fafaf9';
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // disc, its trail and its shadow on the ground
    const hidden = (state === 'sink' && stateT > 0.16 && !pickedUp) || (state === 'ending' && disc.scale < 0.02);
    if (!hidden) {
      const n = trail.length;
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;
        ctx.fillStyle = `rgba(28,25,23,${0.09 * t})`;
        ctx.beginPath();
        ctx.ellipse(trail[i].x, trail[i].y, DISC_W * (0.3 + 0.5 * t), DISC_H * (0.4 + 0.5 * t), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hudAlpha > 0.01 && disc.y < GROUND - 4) {
        const up = clamp((GROUND - disc.y) / (H * 0.6), 0, 1);
        ctx.globalAlpha = hudAlpha * 0.16 * (1 - up);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.ellipse(disc.x, GROUND + 1, DISC_W * (1 - 0.5 * up), 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      let ox = 0;
      let oy = 0;
      if (state === 'aim' && aim.active && !aim.keyboard) {
        ox = -Math.cos(aim.ang) * aim.power * 4;
        oy = -Math.sin(aim.ang) * aim.power * 4;
      }
      drawDisc(disc.x + ox, disc.y + oy, disc.scale, disc.pitch);
    }

    for (const p of pops) {
      const t = p.t / p.life;
      const sc = t < 0.18 ? easeOutBack(t / 0.18, 2) : 1;
      ctx.save();
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      ctx.translate(p.x, p.y - 30 * (1 - Math.pow(1 - t, 2)));
      ctx.scale(0.6 + 0.4 * sc, 0.6 + 0.4 * sc);
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
      for (let i = 0; i < throws; i++) {
        ctx.fillStyle = i < h.par ? INK : '#d6d3d1';
        ctx.beginPath();
        ctx.arc(W - pad - 3 - (throws - 1 - i) * 10, pad + 40, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (hintAlpha > 0.01) {
      ctx.globalAlpha = hintAlpha;
      ctx.font = `400 ${W < 400 ? 11 : 12}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      ctx.fillText(coarse ? 'pull back and let go' : 'pull back and let go  ·  esc to quit', W / 2, H - 16);
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
      basket.target > basket.scale ? Math.min(1, basket.scale + dt / 0.35) : Math.max(0, basket.scale - dt / 0.22);
    const bs = basket.scale;
    basket.rattle = Math.max(0, basket.rattle - dt * 1.6);
    disc.sq = Math.max(0, disc.sq - dt * 9);

    if (state === 'intro') stepIntro(dt);
    else if (state === 'flight') {
      const steps = Math.ceil(dt * 240);
      const h = dt / steps;
      for (let i = 0; i < steps && state === 'flight'; i++) stepFlight(h);
      // the nose follows the flight path a little; spin with speed
      const sp = Math.hypot(disc.vx, disc.vy);
      const target =
        sp > REST_SPEED ? clamp(Math.atan2(disc.vy, Math.abs(disc.vx)) * 0.5, -0.5, 0.5) * Math.sign(disc.vx || 1) : 0;
      disc.pitch = lerp(disc.pitch, target, ease(10, dt));
      disc.spin += (sp / 40) * dt;
      trail.push({ x: disc.x, y: disc.y });
      if (trail.length > 12) trail.shift();
    } else {
      if (trail.length) trail.shift();
      if (state !== 'ending') disc.pitch = lerp(disc.pitch, 0, ease(10, dt));
      if (state === 'sink') stepSink();
      else if (state === 'ending') stepEnding(dt);
    }

    stepTrees(dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += G * 0.5 * dt;
      p.vx *= Math.exp(-2 * dt);
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
