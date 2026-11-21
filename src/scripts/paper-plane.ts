// Paper plane: the copy icon by "email" folds into a paper plane and
// launches. Hold anywhere to pull the nose up and climb; let go and it
// dives and picks up speed. Climb too long and it stalls. Fly through the
// envelopes to deliver mail. Smacking into letters creases the plane (three
// creases and it crumples), and so does hitting the floor. The screen wraps left to right.

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
  easeOutCubic,
  easeInOutCubic,
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

const DELIVERIES = 5;
const CREASES = 3; // hits it can take before it crumples
const HIT_R = 6;
const ENV_W = 22;
const ENV_H = 15;
const SPRING_K = 700;
const SPRING_C = 16;

export function startPaperPlane(icon: Element | null, onEnd: (won: boolean) => void) {
  const overlay = createOverlay();
  const { canvas, ctx, W, H, coarse } = overlay;
  canvas.style.cursor = 'pointer';

  // World scale so a phone flies like a desktop, just smaller.
  const k = clamp(Math.hypot(W, H) / 1250, 0.6, 1.3);
  // Speed settles toward a cruise speed that rises in a dive and falls in a
  // climb, but never below flying speed, so holding always climbs. Extra
  // speed from a dive bleeds off slowly, so dive-then-pull-up zooms high.
  const V0 = 400 * k;
  const V_CRUISE = 400 * k;
  const DIVE_GAIN = 320 * k; // speed added per sin(pitch)
  const PITCH_UP = 1.9; // rad/s while held
  const PITCH_DOWN = 1.3; // rad/s once released
  const MAX_PITCH = 1.1; // steepest dive
  const MAX_CLIMB = 0.9; // steepest climb
  const STALL_AFTER = 1.6; // seconds of steep climbing before it stalls
  const FLOOR = H - 26;

  // --- Course -------------------------------------------------------------
  const collected = collectGlyphs(ctx, H);
  const iconGlyph = collected.glyphs.find((g) => g.el === icon);
  const trees: Tree[] = collected.glyphs
    .filter((g) => g !== iconGlyph)
    .map((g) => ({ ...g, dx: 0, dy: 0, vx: 0, vy: 0, shaking: false }));
  if (iconGlyph) iconGlyph.el.style.visibility = 'hidden';
  const iconRect = icon?.getBoundingClientRect();
  const home = iconRect
    ? { x: iconRect.left + iconRect.width / 2, y: iconRect.top + iconRect.height / 2 }
    : { x: W / 2, y: H / 2 };

  const clearOf = (b: Box) => !trees.some((t) => t.box.r > b.l && t.box.l < b.r && t.box.b > b.t && t.box.t < b.b);

  // --- State --------------------------------------------------------------
  type State = 'launch' | 'fly' | 'crash' | 'ending';
  let state: State = 'launch';
  let stateT = 0;
  let time = 0;
  let holding = false;
  let held = false; // has the player ever held
  let delivered = 0;
  let won = false;
  const plane = { x: home.x, y: home.y, a: -0.35, v: V0, scale: 0.3, stall: 0, wobble: 0, roll: 0 };
  const env = { x: 0, y: 0, scale: 0, bob: 0, alive: false };
  const trail: { x: number; y: number; gap: boolean }[] = [];
  const particles: Particle[] = [];
  const rings: Ring[] = [];
  const pops: Pop[] = [];
  const endFrom = { x: 0, y: 0, a: 0, scale: 1 };
  let hudAlpha = 0;
  let hintAlpha = 0;
  let crumple = 0;
  let climbT = 0;
  let creases = 0;
  let invuln = 0;
  let creaseT = 1; // time since the last crease, for the HUD flash

  const pop = (x: number, y: number, text: string, color = INK, size = 13) =>
    pops.push({ x, y, text, color, size, t: 0, life: 1 });

  function setState(s: State) {
    state = s;
    stateT = 0;
  }

  /** Put the next envelope somewhere clear, a fair flight away. */
  function placeEnvelope() {
    const minD = Math.min(W, H) * (0.3 + 0.04 * delivered);
    let best: { x: number; y: number; score: number } | null = null;
    for (let i = 0; i < 400; i++) {
      const x = rand(30, W - 30);
      const y = rand(90, FLOOR - 70);
      const box = { l: x - ENV_W / 2 - 10, r: x + ENV_W / 2 + 10, t: y - ENV_H / 2 - 10, b: y + ENV_H / 2 + 10 };
      if (!clearOf(box)) continue;
      // distance ahead of the plane, counting the wrap
      const ahead = (x - plane.x + W) % W;
      const d = Math.hypot(Math.min(ahead, W - ahead), y - plane.y);
      if (d < minD) continue;
      // never level with the plane: every delivery takes a climb or a dive
      if (Math.abs(y - plane.y) < 50) continue;
      // later envelopes like to tuck in near the text
      let near = Infinity;
      for (const t of trees) {
        const dx = Math.max(t.box.l - x, 0, x - t.box.r);
        const dy = Math.max(t.box.t - y, 0, y - t.box.b);
        near = Math.min(near, Math.hypot(dx, dy));
      }
      const score = Math.random() + (near < 60 ? delivered * 0.25 : 0);
      if (!best || score > best.score) best = { x, y, score };
    }
    const p = best ?? { x: W / 2, y: H * 0.4 };
    env.x = p.x;
    env.y = p.y;
    env.scale = 0;
    env.alive = true;
  }

  // --- Input --------------------------------------------------------------
  const press = () => {
    if (state !== 'fly' && state !== 'launch') return;
    holding = true;
    held = true;
  };
  const lift = () => {
    holding = false;
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    press();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return end();
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) press();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') lift();
  };
  const onResize = () => {
    if (window.innerWidth !== W) end();
  };

  // --- Flight -------------------------------------------------------------
  function strike(t: Tree, nx: number, ny: number) {
    t.vx -= nx * 70;
    t.vy -= ny * 70;
    if (!t.shaking) {
      t.shaking = true;
      t.el.style.visibility = 'hidden';
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.atan2(ny, nx) + rand(-1, 1);
      const s = rand(60, 160) * k;
      particles.push({ x: plane.x, y: plane.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1, 1.8), color: GREEN, t: 0, life: rand(0.3, 0.5) });
    }
  }

  function stepFlight(dt: number) {
    invuln = Math.max(0, invuln - dt);
    // pitch: hold to pull the nose up, let go and it eases into a dive.
    // Until the first hold it just glides gently, so nobody crashes while
    // reading the hint.
    if (!held) {
      plane.a = lerp(plane.a, 0.1, ease(3, dt));
      plane.v = lerp(plane.v, V0, ease(2, dt));
    } else if (plane.stall > 0) {
      plane.stall -= dt;
      plane.a = Math.min(MAX_PITCH, plane.a + 3.2 * dt);
    } else if (holding) {
      plane.a = Math.max(-MAX_CLIMB, plane.a - PITCH_UP * dt);
    } else {
      plane.a = Math.min(MAX_PITCH, plane.a + PITCH_DOWN * dt);
    }

    const target = V_CRUISE + DIVE_GAIN * Math.sin(plane.a);
    plane.v += (target - plane.v) * ease(plane.v > target ? 0.8 : 1.8, dt);

    // hold a steep climb too long and it stalls
    if (holding && plane.stall <= 0 && plane.a < -0.6) climbT += dt;
    else climbT = Math.max(0, climbT - dt * 2);
    if (climbT > STALL_AFTER) {
      climbT = 0;
      plane.stall = 0.5;
      plane.wobble = 1;
      pop(plane.x, plane.y - 18, 'stall', MUTED, 11);
    }

    plane.x += Math.cos(plane.a) * plane.v * dt;
    plane.y += Math.sin(plane.a) * plane.v * dt;

    // the sky wraps left to right
    if (plane.x > W + 20) {
      plane.x -= W + 40;
      trail.push({ x: plane.x, y: plane.y, gap: true });
    } else if (plane.x < -20) {
      plane.x += W + 40;
      trail.push({ x: plane.x, y: plane.y, gap: true });
    }
    if (plane.y < 10) {
      plane.y = 10;
      plane.a = Math.max(plane.a, 0.25);
      plane.v *= 0.9;
    }

    for (const t of trees) {
      const hit = circleBox(plane.x, plane.y, HIT_R, t.box);
      if (!hit) continue;
      plane.x += hit.nx * hit.depth;
      plane.y += hit.ny * hit.depth;
      // glance off: lose speed and get knocked toward the surface normal
      const along = Math.cos(plane.a) * hit.nx + Math.sin(plane.a) * hit.ny;
      if (along < 0) {
        plane.v *= 0.72;
        plane.a = clamp(plane.a + (hit.ny < 0 ? -0.35 : 0.35), -MAX_PITCH, MAX_PITCH);
        plane.wobble = 1;
        strike(t, hit.nx, hit.ny);
        // a real smack (not a graze) creases the paper
        if (along < -0.3 && invuln <= 0) {
          creases++;
          invuln = 0.7;
          creaseT = 0;
          if (creases >= CREASES) {
            crash();
            return;
          }
          pop(plane.x, plane.y - 18, CREASES - creases === 1 ? 'one more and it crumples' : 'creased', MUTED, 11);
        }
      }
    }

    // mail delivered
    if (env.alive && env.scale > 0.6 && Math.hypot(plane.x - env.x, plane.y - env.y) < 20) {
      env.alive = false;
      delivered++;
      rings.push({ x: env.x, y: env.y, r0: 12, r1: 46, t: 0, life: 0.5, color: GREEN, w: 1.5 });
      for (let i = 0; i < 8; i++) {
        const a = rand(0, Math.PI * 2);
        const s = rand(80, 220) * k;
        particles.push({ x: env.x, y: env.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1, 2), color: GREEN, t: 0, life: rand(0.35, 0.6) });
      }
      if (delivered >= DELIVERIES) {
        won = true;
        pop(env.x, env.y - 20, 'all sent', GREEN, 14);
        end();
        return;
      }
      pop(env.x, env.y - 20, 'sent', GREEN, 13);
      placeEnvelope();
    }

    if (plane.y > FLOOR) {
      plane.y = FLOOR;
      crash();
    }
  }

  function crash() {
    setState('crash');
    holding = false;
    crumple = 0;
    for (let i = 0; i < 6; i++) {
      const a = rand(-Math.PI, 0);
      const s = rand(60, 160) * k;
      particles.push({ x: plane.x, y: plane.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(0.8, 1.6), color: MUTED, t: 0, life: rand(0.3, 0.5) });
    }
    pop(plane.x, plane.y - 22, delivered ? `crumpled · ${delivered} sent` : 'crumpled', MUTED, 12);
  }

  // --- Ending -------------------------------------------------------------
  function end() {
    if (state === 'ending') return;
    endFrom.x = plane.x;
    endFrom.y = plane.y;
    endFrom.a = plane.a;
    endFrom.scale = plane.scale;
    env.alive = false;
    setState('ending');
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
  function drawPlane(x: number, y: number, a: number, scale: number, crumpled: number) {
    ctx.save();
    ctx.translate(x, y);
    const flutter = plane.wobble * Math.sin(time * 40) * 0.18 + (plane.stall > 0 ? Math.sin(time * 22) * 0.15 : 0);
    ctx.rotate(a + flutter);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    if (crumpled > 0.01) {
      // folds collapse into a little paper ball
      const c = easeOutCubic(crumpled);
      ctx.rotate(c * 4);
      ctx.fillStyle = '#fafaf9';
      ctx.beginPath();
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const r = lerp(12, 6 + ((i * 37) % 5) * 0.6, c);
        const px = Math.cos(ang) * r * (1 + (1 - c) * 0.6);
        const py = Math.sin(ang) * r * (1 - (1 - c) * 0.5);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    // side-on dart: a long nose, the near wing, and the fold under it
    ctx.fillStyle = '#fafaf9';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-11, -7);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e7e5e4';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-9, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // creases: crooked fold lines across the wing, one per hit
    ctx.strokeStyle = 'rgba(28,25,23,0.55)';
    ctx.lineWidth = 1;
    const folds = [
      [4, -1, -1, -4.5, -5, -3],
      [-2, -0.5, -6, -5.5, -8, -4],
      [9, -0.5, 5, -2.5, 2, -1.5],
    ];
    for (let i = 0; i < Math.min(creases, folds.length); i++) {
      const f = folds[i];
      ctx.beginPath();
      ctx.moveTo(f[0], f[1]);
      ctx.lineTo(f[2], f[3]);
      ctx.lineTo(f[4], f[5]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEnvelope() {
    if (env.scale < 0.01) return;
    const bob = Math.sin(time * 2.4) * 2;
    ctx.save();
    ctx.translate(env.x, env.y + bob);
    ctx.scale(env.scale, env.scale);
    // beacon
    const t = (time % 1.6) / 1.6;
    ctx.globalAlpha = 0.28 * (1 - t);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 18 + 16 * easeOutCubic(t), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fafaf9';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.rect(-ENV_W / 2, -ENV_H / 2, ENV_W, ENV_H);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(-ENV_W / 2, -ENV_H / 2);
    ctx.lineTo(0, 1.5);
    ctx.lineTo(ENV_W / 2, -ENV_H / 2);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    overlay.clear();

    // floor line
    if (hudAlpha > 0.01) {
      ctx.globalAlpha = 0.45 * hudAlpha;
      ctx.fillStyle = MUTED;
      for (let x = 4; x < W; x += 7) ctx.fillRect(x, FLOOR + 6, 2.5, 1);
      ctx.globalAlpha = 1;
    }

    for (const t of trees) if (t.shaking) drawGlyph(ctx, t, t.hx + t.dx, t.hy + t.dy, t.dx * 0.05);

    drawEnvelope();

    // flight path: a fine dashed line that fades behind the plane
    if (trail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < trail.length; i++) {
        if (trail[i].gap) continue;
        if (i % 3 === 0) continue;
        const f = i / trail.length;
        ctx.globalAlpha = 0.22 * f;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

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

    if (plane.scale > 0.02) {
      // blink during the grace after a crease
      ctx.globalAlpha = invuln > 0 && Math.floor(time * 16) % 2 ? 0.35 : 1;
      drawPlane(plane.x, plane.y, plane.a, plane.scale, crumple);
      ctx.globalAlpha = 1;
    }

    for (const p of pops) {
      const t = p.t / p.life;
      const sc = t < 0.2 ? easeOutBack(t / 0.2, 2) : 1;
      ctx.save();
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      ctx.translate(p.x, p.y - 22 * easeOutCubic(t));
      ctx.scale(0.6 + 0.4 * sc, 0.6 + 0.4 * sc);
      ctx.font = `500 ${p.size}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }

    // HUD: envelopes delivered
    const pad = W < 640 ? 16 : 28;
    if (hudAlpha > 0.01) {
      ctx.globalAlpha = hudAlpha;
      ctx.font = `500 12px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#44403c';
      ctx.fillText(`sent ${delivered}/${DELIVERIES}`, W - pad, pad + 12);
      for (let i = 0; i < DELIVERIES; i++) {
        const x = W - pad - 3 - (DELIVERIES - 1 - i) * 10;
        ctx.fillStyle = i < delivered ? GREEN : '#d6d3d1';
        ctx.beginPath();
        ctx.arc(x, pad + 26, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // hits left: little paper darts, greyed out as they're used up
      for (let i = 0; i < CREASES; i++) {
        const x = W - pad - 4 - (CREASES - 1 - i) * 13;
        const y = pad + 40;
        const left = i < CREASES - creases;
        const justLost = !left && i === CREASES - creases && creaseT < 0.5;
        ctx.save();
        ctx.translate(x, y);
        if (justLost) ctx.scale(1 + (0.5 - creaseT), 1 + (0.5 - creaseT));
        ctx.fillStyle = left ? '#fafaf9' : 'transparent';
        ctx.strokeStyle = left ? INK : '#d6d3d1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-4, -3);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 2.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    if (hintAlpha > 0.01) {
      ctx.globalAlpha = hintAlpha;
      ctx.font = `400 ${W < 400 ? 11 : 12}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      ctx.fillText(
        coarse ? 'hold to climb  ·  let go to dive' : 'hold to climb  ·  let go to dive  ·  esc to quit',
        W / 2,
        FLOOR - 14
      );
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

    hudAlpha = lerp(hudAlpha, state === 'fly' || state === 'crash' ? 1 : 0, ease(8, dt));
    hintAlpha = lerp(hintAlpha, (state === 'fly' || state === 'launch') && !held ? 1 : 0, ease(held ? 10 : 4, dt));
    plane.wobble = Math.max(0, plane.wobble - dt * 3);
    creaseT += dt;
    env.scale = env.alive ? Math.min(1, env.scale + dt / 0.3) : Math.max(0, env.scale - dt / 0.2);

    if (state === 'launch') {
      // the icon unfolds into a plane and is tossed into the air
      const t = clamp(stateT / 0.5, 0, 1);
      plane.scale = lerp(0.3, 1, easeOutBack(t, 1.6));
      plane.x = home.x + easeOutCubic(t) * 30;
      plane.y = home.y - Math.sin(Math.PI * t * 0.5) * 24;
      plane.a = -0.35;
      if (t >= 1) {
        setState('fly');
        placeEnvelope();
      }
    } else if (state === 'fly') {
      const steps = Math.ceil(dt * 240);
      const h = dt / steps;
      for (let i = 0; i < steps && state === 'fly'; i++) stepFlight(h);
      trail.push({ x: plane.x, y: plane.y, gap: false });
      if (trail.length > 70) trail.shift();
    } else if (state === 'crash') {
      crumple = Math.min(1, stateT / 0.3);
      if (stateT > 0.9) end();
    } else if (state === 'ending') {
      if (trail.length) trail.splice(0, 3);
      // fly (or roll) back to the icon and fold up into it
      const t = clamp(stateT / 0.6, 0, 1);
      const e = easeInOutCubic(t);
      plane.x = lerp(endFrom.x, home.x, e);
      plane.y = lerp(endFrom.y, home.y, e) - Math.sin(Math.PI * t) * 50;
      plane.a = lerp(endFrom.a, 0, e);
      plane.scale = lerp(endFrom.scale, 0.3, e);
      if (t >= 1 && trees.every((tr) => !tr.shaking)) return cleanup();
    }

    stepTrees(dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += 500 * k * dt;
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

    render();
    if (raf) raf = requestAnimationFrame(frame);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', lift);
    canvas.removeEventListener('pointercancel', lift);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    overlay.unmount();
    for (const g of collected.glyphs) g.el.style.visibility = '';
    collected.restore();
    onEnd(won);
  }

  overlay.mount();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);
}
