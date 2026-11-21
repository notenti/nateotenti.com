// Email catch: click "email" three times and the copy icon becomes a catcher.
// The letters of the address come loose from the page (a matching letter
// wiggles, then drops), mixed with decoys. Catch them in order to spell the
// address; a wrong catch knocks the last letter back off. Spell it and the
// address is copied, then everything flies home.

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
  wrapAngle,
  createOverlay,
  collectGlyphs,
  drawGlyph,
  type Glyph,
} from './game-kit';

type Phase = 'wiggle' | 'fall' | 'bounce' | 'caught' | 'home' | 'gone';

interface Piece {
  g: Glyph; // the page letter it came from (or a made-up one)
  ch: string; // lowercase character it stands for
  synthetic: boolean;
  phase: Phase;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  alpha: number;
  slot: number; // index in the address once caught
  sway: number; // phase of its side-to-side drift
  from?: { x: number; y: number; a: number };
}

interface Particle { x: number; y: number; vx: number; vy: number; r: number; color: string; t: number; life: number }
interface Pop { x: number; y: number; text: string; color: string; size: number; t: number; life: number }

const LOOKALIKES: Record<string, string> = {
  o: 'ce', e: 'ca', a: 'eo', c: 'oe', n: 'mh', m: 'nw', h: 'nb', t: 'fl', f: 't',
  i: 'lj', l: 'it', g: 'qy', q: 'g', '.': ',', '@': 'ao', u: 'vn', v: 'u', r: 'n',
};
const WIGGLE = 0.24; // barely any warning before a letter drops
const FLY_TO_SLOT = 0.32;

export function startEmailCatch(button: HTMLElement, address: string, onEnd: (done: boolean) => void) {
  const overlay = createOverlay();
  const { canvas, ctx, W, H, coarse } = overlay;
  canvas.style.cursor = coarse ? 'default' : 'none';
  const k = clamp(H / 860, 0.7, 1.3);

  const target = Array.from(address.toLowerCase());
  const collected = collectGlyphs(ctx, H);
  const pool = collected.glyphs.filter((g) => !g.img && g.box.b > 0 && g.box.t < H);
  const inUse = new Set<Glyph>();

  // The copy icon is the catcher; start where it sits on the page.
  const icon = button.querySelector('svg');
  const iconRect = icon?.getBoundingClientRect();
  const iconGlyph = collected.glyphs.find((g) => g.el === icon);
  if (iconGlyph) iconGlyph.el.style.visibility = 'hidden';

  const CATCH_Y = H - 84;
  const HALF = 18;
  const catcher = {
    x: iconRect ? iconRect.left + iconRect.width / 2 : W / 2,
    y: iconRect ? iconRect.top + iconRect.height / 2 : CATCH_Y,
    tx: W / 2,
    vx: 0,
    scale: iconRect ? iconRect.width / 30 : 0.3,
    squash: 0,
    flash: 0,
    flashColor: GREEN,
    shake: 0,
  };

  // --- State --------------------------------------------------------------
  type State = 'intro' | 'play' | 'done' | 'ending';
  let state: State = 'intro';
  let stateT = 0;
  let time = 0;
  let spelled = 0; // how many letters of the address are caught
  let spawnT = 0;
  let firstCatch = false;
  let hintAlpha = 0;
  let uiAlpha = 0;
  let doneFlash = 0;
  const pieces: Piece[] = [];
  const caught: (Piece | null)[] = target.map(() => null);
  const particles: Particle[] = [];
  const pops: Pop[] = [];
  const keys = { left: false, right: false };
  let usingKeys = false;

  const pop = (x: number, y: number, text: string, color = INK, size = 13) =>
    pops.push({ x, y, text, color, size, t: 0, life: 0.9 });

  // Slot positions for the spelled address, centered near the top.
  const SLOT_FONT = `500 ${W < 400 ? 15 : 17}px ${MONO}`;
  ctx.font = SLOT_FONT;
  const cw = ctx.measureText('m').width;
  const slotY = 64;
  const slotX = (i: number) => W / 2 - (target.length * cw) / 2 + cw * (i + 0.5);

  // --- Spawning -----------------------------------------------------------
  function makePiece(ch: string): Piece {
    // Prefer a matching letter from the page, nearest the top.
    const matches = pool.filter((g) => !inUse.has(g) && g.ch.toLowerCase() === ch);
    let g: Glyph;
    let synthetic = false;
    if (matches.length) {
      g = matches[Math.floor(Math.random() * Math.min(matches.length, 6))];
      inUse.add(g);
      g.el.style.visibility = 'hidden';
    } else {
      // Not on the page (like "@"): drop one in from the top.
      synthetic = true;
      const font = `500 ${Math.round(20 * k)}px ${MONO}`;
      ctx.font = font;
      const m = ctx.measureText(ch);
      const L = m.actualBoundingBoxLeft;
      const R = m.actualBoundingBoxRight;
      const A = m.actualBoundingBoxAscent;
      const D = m.actualBoundingBoxDescent;
      const x = rand(40, W - 40);
      const y = -24;
      g = {
        el: document.createElement('span'),
        ch,
        font,
        color: INK,
        size: 20 * k,
        hx: x,
        hy: y,
        // from the ink center back to the baseline-left origin
        ox: -(R - L) / 2,
        oy: (A - D) / 2,
        hw: (R + L) / 2,
        hh: (A + D) / 2,
        box: { l: x - L, r: x + R, t: y - A, b: y + D },
        word: { text: ch, glyphs: [] },
      };
    }
    const p: Piece = {
      g,
      ch,
      synthetic,
      phase: synthetic ? 'fall' : 'wiggle',
      t: 0,
      x: g.hx,
      y: g.hy,
      vx: rand(-40, 40) * k,
      vy: synthetic ? 60 * k : 0,
      a: 0,
      va: rand(-1.2, 1.2),
      alpha: 1,
      slot: -1,
      sway: rand(0, Math.PI * 2),
    };
    pieces.push(p);
    return p;
  }

  const falling = () => pieces.filter((p) => p.phase === 'wiggle' || p.phase === 'fall');

  function spawn() {
    const need = target[spelled];
    const live = falling();
    const maxLive = 3 + Math.min(3, Math.floor(spelled / 5));
    if (live.length >= maxLive) return;
    if (!live.some((p) => p.ch === need)) {
      makePiece(need);
      return;
    }
    // A decoy: often a look-alike of the letter you need, otherwise another
    // letter from the address, so it all looks plausible.
    const alike = LOOKALIKES[need];
    if (alike && Math.random() < 0.45) {
      const opts = Array.from(alike);
      return void makePiece(opts[Math.floor(Math.random() * opts.length)]);
    }
    const rest = target.slice(spelled + 1).filter((c) => c !== need);
    const pick = rest.length && Math.random() < 0.7 ? rest[Math.floor(Math.random() * rest.length)] : null;
    if (pick) return void makePiece(pick);
    const others = pool.filter((g) => !inUse.has(g) && /[a-z]/i.test(g.ch) && g.ch.toLowerCase() !== need);
    if (others.length) makePiece(others[Math.floor(Math.random() * others.length)].ch.toLowerCase());
  }

  // --- Input --------------------------------------------------------------
  const onPointerMove = (e: PointerEvent) => {
    usingKeys = false;
    catcher.tx = clamp(e.clientX, HALF, W - HALF);
  };
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    usingKeys = false;
    catcher.tx = clamp(e.clientX, HALF, W - HALF);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return end(false);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      usingKeys = true;
      if (e.key === 'ArrowLeft') keys.left = true;
      else keys.right = true;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  };
  const onResize = () => {
    if (window.innerWidth !== W) end(false);
  };

  // --- Catching -----------------------------------------------------------
  function burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0);
      const s = rand(60, 200) * k;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1, 2), color, t: 0, life: rand(0.3, 0.55) });
    }
  }

  function tryCatch(p: Piece, prevY: number) {
    const top = CATCH_Y - 14;
    if (prevY > top || p.y < top) return;
    if (Math.abs(p.x - catcher.x) > HALF + p.g.hw * 0.5) return;
    const need = target[spelled];
    if (p.ch === need) {
      p.phase = 'caught';
      p.t = 0;
      p.slot = spelled;
      p.from = { x: p.x, y: p.y, a: p.a };
      caught[spelled] = p;
      spelled++;
      firstCatch = true;
      catcher.squash = 1;
      catcher.flash = 1;
      catcher.flashColor = GREEN;
      burst(p.x, top, GREEN, 5);
      if (spelled === target.length) finish();
    } else {
      // wrong letter: it bounces off, and knocks the last caught one loose
      p.phase = 'bounce';
      p.vy = -300 * k;
      p.vx = (p.x < catcher.x ? -1 : 1) * rand(120, 200) * k;
      p.va = rand(-8, 8);
      catcher.shake = 1;
      catcher.flash = 1;
      catcher.flashColor = INK;
      knockOff('oops');
    }
  }

  /** Lose the last caught letter: it tumbles out of the address. */
  function knockOff(label: string) {
    if (spelled === 0) return;
    spelled--;
    const lost = caught[spelled];
    caught[spelled] = null;
    if (lost) {
      lost.phase = 'bounce';
      lost.x = slotX(spelled);
      lost.y = slotY;
      lost.vx = rand(-120, 120) * k;
      lost.vy = -160 * k;
      lost.va = rand(-6, 6);
      lost.alpha = 1;
    }
    pop(slotX(spelled), slotY + 26, label, MUTED, 11);
  }

  // A page letter that falls off the bottom quietly reappears at home.
  function sendHome(p: Piece) {
    if (p.synthetic) {
      p.phase = 'gone';
      return;
    }
    p.phase = 'home';
    p.t = 0;
  }

  // --- Ending -------------------------------------------------------------
  function finish() {
    state = 'done';
    stateT = 0;
    doneFlash = 1;
    navigator.clipboard?.writeText(address).catch(() => {});
    pop(W / 2, slotY + 30, 'copied.', GREEN, 13);
  }

  function end(done: boolean) {
    if (state === 'ending') return;
    state = 'ending';
    stateT = 0;
    endDone = done;
    // everything still out goes home: page letters to their spot, made-up
    // ones fade
    for (const p of pieces) {
      if (p.phase === 'gone') continue;
      if (p.phase === 'caught') {
        const slotPos = p.t >= FLY_TO_SLOT ? { x: slotX(p.slot), y: slotY } : { x: p.x, y: p.y };
        p.x = slotPos.x;
        p.y = slotPos.y;
      }
      p.from = { x: p.x, y: p.y, a: wrapAngle(p.a) };
      p.phase = 'home';
      p.t = -rand(0, 0.25);
    }
  }
  let endDone = false;

  // --- Step ---------------------------------------------------------------
  function stepPieces(dt: number) {
    const fallMax = (215 + spelled * 9) * k;
    for (const p of pieces) {
      p.t += dt;
      const prevY = p.y;
      switch (p.phase) {
        case 'wiggle':
          if (p.t >= WIGGLE) {
            p.phase = 'fall';
            p.t = 0;
          }
          break;
        case 'fall':
          p.vy = Math.min(fallMax, p.vy + 520 * k * dt);
          p.x += (p.vx + Math.sin(p.t * 2.4 + p.sway) * 55 * k) * dt;
          p.y += p.vy * dt;
          p.a += p.va * dt * 0.4;
          if (p.x < 12 || p.x > W - 12) p.vx = -p.vx;
          if (state === 'play') tryCatch(p, prevY);
          if (p.phase === 'fall' && p.y > H + 30) {
            // let the one you needed get away and you lose your last letter
            if (state === 'play' && p.ch === target[spelled]) knockOff('missed');
            sendHome(p);
          }
          break;
        case 'bounce':
          p.vy += 900 * k * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.a += p.va * dt;
          if (p.y > H + 30) sendHome(p);
          break;
        case 'caught':
          if (p.from && p.t < FLY_TO_SLOT) {
            const e = easeInOutCubic(p.t / FLY_TO_SLOT);
            p.x = lerp(p.from.x, slotX(p.slot), e);
            p.y = lerp(p.from.y, slotY, e) - Math.sin(Math.PI * e) * 30;
            p.a = lerp(p.from.a, 0, e);
          } else {
            p.x = slotX(p.slot);
            p.y = slotY;
            p.a = 0;
          }
          break;
        case 'home': {
          if (p.synthetic) {
            p.alpha = Math.max(0, p.alpha - dt * 3);
            if (p.alpha <= 0) p.phase = 'gone';
            break;
          }
          if (state === 'ending' && p.from) {
            if (p.t < 0) break;
            const d = 0.55;
            const e = easeOutBack(clamp(p.t / d, 0, 1), 1.3);
            p.x = lerp(p.from.x, p.g.hx, e);
            p.y = lerp(p.from.y, p.g.hy, e);
            p.a = lerp(p.from.a, 0, e);
            p.alpha = 1;
            if (p.t >= d) {
              p.phase = 'gone';
              p.g.el.style.visibility = '';
              inUse.delete(p.g);
            }
          } else {
            // fade back in where it lives
            p.x = p.g.hx;
            p.y = p.g.hy;
            p.a = 0;
            p.alpha = clamp(p.t / 0.3, 0, 1);
            if (p.t >= 0.3) {
              p.phase = 'gone';
              p.g.el.style.visibility = '';
              inUse.delete(p.g);
            }
          }
          break;
        }
      }
    }
    for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].phase === 'gone') pieces.splice(i, 1);
  }

  function stepCatcher(dt: number) {
    if (state === 'intro') {
      // the copy icon grows into the catcher and drops to its rail
      const t = clamp(stateT / 0.55, 0, 1);
      const e = easeInOutCubic(t);
      catcher.x = lerp(iconRect ? iconRect.left + iconRect.width / 2 : W / 2, W / 2, e);
      catcher.y = lerp(iconRect ? iconRect.top + iconRect.height / 2 : CATCH_Y, CATCH_Y, e) - Math.sin(Math.PI * t) * 40;
      catcher.scale = lerp(iconRect ? iconRect.width / 30 : 0.3, 1, easeOutBack(t, 1.4));
      catcher.tx = catcher.x;
      if (t >= 1) {
        state = 'play';
        stateT = 0;
      }
      return;
    }
    if (state === 'ending') {
      // shrink back into the icon
      const t = clamp((stateT - 0.2) / 0.5, 0, 1);
      const e = easeInOutCubic(t);
      if (!endFromCatcher) endFromCatcher = { x: catcher.x, y: catcher.y };
      catcher.x = lerp(endFromCatcher.x, iconRect ? iconRect.left + iconRect.width / 2 : W / 2, e);
      catcher.y = lerp(endFromCatcher.y, iconRect ? iconRect.top + iconRect.height / 2 : H, e);
      catcher.scale = lerp(1, iconRect ? iconRect.width / 30 : 0, e);
      return;
    }
    if (usingKeys) {
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      catcher.tx = clamp(catcher.tx + dir * 520 * k * dt, HALF, W - HALF);
    }
    const nx = lerp(catcher.x, catcher.tx, ease(coarse ? 22 : 30, dt));
    catcher.vx = (nx - catcher.x) / Math.max(dt, 1e-4);
    catcher.x = nx;
  }
  let endFromCatcher: { x: number; y: number } | null = null;

  // --- Render -------------------------------------------------------------
  function drawCatcher() {
    const { x, y } = catcher;
    ctx.save();
    const shake = catcher.shake * Math.sin(time * 60) * 3;
    ctx.translate(x + shake, y);
    // lean into the motion a touch
    ctx.rotate(clamp(catcher.vx / 4000, -0.12, 0.12));
    const sq = catcher.squash * 0.18;
    ctx.scale(catcher.scale * (1 + sq), catcher.scale * (1 - sq));
    const col = catcher.flash > 0.05 ? catcher.flashColor : INK;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // the copy icon: a back sheet peeking out behind a front sheet, scaled
    // up from the 10x10 glyph (front sheet is the open-topped catcher)
    ctx.beginPath();
    ctx.moveTo(-6, 6);
    ctx.lineTo(-13, 6);
    ctx.quadraticCurveTo(-15, 6, -15, 4);
    ctx.lineTo(-15, -13);
    ctx.quadraticCurveTo(-15, -15, -13, -15);
    ctx.lineTo(4, -15);
    ctx.quadraticCurveTo(6, -15, 6, -13);
    ctx.lineTo(6, -9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.lineTo(-9, 13);
    ctx.quadraticCurveTo(-9, 15, -7, 15);
    ctx.lineTo(13, 15);
    ctx.quadraticCurveTo(15, 15, 15, 13);
    ctx.lineTo(15, -6);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.lineTo(15, -6);
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    overlay.clear();

    // the address being spelled
    if (uiAlpha > 0.01) {
      ctx.font = SLOT_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < target.length; i++) {
        const x = slotX(i);
        const p = caught[i];
        const landed = p && p.t >= FLY_TO_SLOT && p.phase === 'caught';
        if (landed) {
          ctx.globalAlpha = uiAlpha;
          ctx.fillStyle = doneFlash > 0.01 ? GREEN : INK;
          ctx.fillText(target[i], x, slotY);
        } else if (i === spelled && state === 'play') {
          // the next one you need: a pulsing green bar
          ctx.globalAlpha = uiAlpha * (0.55 + 0.45 * Math.sin(time * 6));
          ctx.fillStyle = GREEN;
          ctx.fillRect(x - cw * 0.35, slotY + 9, cw * 0.7, 2);
          ctx.globalAlpha = uiAlpha * 0.28;
          ctx.fillStyle = MUTED;
          ctx.fillText(target[i], x, slotY);
        } else {
          ctx.globalAlpha = uiAlpha * 0.28;
          ctx.fillStyle = MUTED;
          ctx.fillText(target[i], x, slotY);
        }
      }
      ctx.globalAlpha = 1;
      ctx.textBaseline = 'alphabetic';
    }

    for (const p of pieces) {
      if (p.phase === 'gone') continue;
      if (p.phase === 'caught' && p.t >= FLY_TO_SLOT && state !== 'ending') continue; // drawn as a slot
      let x = p.x;
      let y = p.y;
      let a = p.a;
      if (p.phase === 'wiggle') {
        const w = Math.sin(p.t * 55) * 1.6 * (1 - p.t / WIGGLE);
        x += w;
        a = w * 0.06;
        y -= easeOutCubic(p.t / WIGGLE) * 3;
      }
      const sc = p.phase === 'caught' ? lerp(1, 0.9, clamp(p.t / FLY_TO_SLOT, 0, 1)) : 1;
      drawGlyph(ctx, p.g, x, y, a, p.alpha, sc);
    }

    for (const q of particles) {
      ctx.globalAlpha = 1 - q.t / q.life;
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (catcher.scale > 0.05) drawCatcher();

    for (const p of pops) {
      const t = p.t / p.life;
      const sc = t < 0.2 ? easeOutBack(t / 0.2, 2) : 1;
      ctx.save();
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      ctx.translate(p.x, p.y - 16 * easeOutCubic(t));
      ctx.scale(0.6 + 0.4 * sc, 0.6 + 0.4 * sc);
      ctx.font = `500 ${p.size}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }

    if (hintAlpha > 0.01) {
      ctx.globalAlpha = hintAlpha;
      ctx.font = `400 ${W < 400 ? 11 : 12}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      ctx.fillText(
        coarse ? 'catch them in order  ·  drag to move' : 'catch them in order  ·  esc to quit',
        W / 2,
        H - 28
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

    uiAlpha = lerp(uiAlpha, state === 'ending' ? 0 : 1, ease(8, dt));
    hintAlpha = lerp(hintAlpha, state === 'play' && !firstCatch ? 1 : 0, ease(firstCatch ? 10 : 4, dt));
    catcher.squash = Math.max(0, catcher.squash - dt * 7);
    catcher.flash = Math.max(0, catcher.flash - dt * 3);
    catcher.shake = Math.max(0, catcher.shake - dt * 4);
    doneFlash = Math.max(0, doneFlash - dt * 0.8);

    if (state === 'play') {
      spawnT -= dt;
      if (spawnT <= 0) {
        spawn();
        spawnT = Math.max(0.28, 0.7 - spelled * 0.02);
      }
    }
    if (state === 'done' && stateT > 1.1) end(true);

    stepCatcher(dt);
    stepPieces(dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.t += dt;
      if (q.t >= q.life) {
        particles.splice(i, 1);
        continue;
      }
      q.vy += 700 * k * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      pops[i].t += dt;
      if (pops[i].t >= pops[i].life) pops.splice(i, 1);
    }

    render();
    if (state === 'ending' && pieces.length === 0 && stateT > 0.75) return cleanup();
    if (raf) raf = requestAnimationFrame(frame);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    overlay.unmount();
    for (const g of collected.glyphs) g.el.style.visibility = '';
    collected.restore();
    onEnd(endDone);
  }

  overlay.mount();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);
}
