// Keepy-up: the period after "Nate" becomes a ball. Tap near it to kick it
// upward; every letter it hits breaks loose and scores. Three floor touches
// and the page reassembles itself.

type Box = { l: number; t: number; r: number; b: number };

interface Word {
  text: string;
  letters: Letter[];
  remaining: number;
}

interface Letter {
  el: HTMLElement | SVGElement;
  img?: HTMLImageElement;
  ch: string;
  font: string;
  color: string;
  // home pivot (ink center) and draw offset from pivot to baseline-left
  hx: number;
  hy: number;
  ox: number;
  oy: number;
  hw: number;
  hh: number;
  box: Box;
  heavy: boolean;
  pts: number;
  order: number;
  word: Word;
  alive: boolean;
  // debris state
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  alpha: number;
  settled: boolean;
  ret?: { x: number; y: number; a: number; alpha: number; delay: number; done: boolean };
}

interface Particle { x: number; y: number; vx: number; vy: number; r: number; color: string; t: number; life: number }
interface Ring { x: number; y: number; r0: number; r1: number; t: number; life: number; color: string; w: number }
interface Pop { x: number; y: number; text: string; color: string; size: number; t: number; life: number }
interface FloorFlash { x: number; t: number; life: number }

const INK = '#1c1917';
const GREEN = '#76b900';
const MUTED = '#a8a29e';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const GRAVITY = 1700;
const BALL_R = 10;
const MAX_SPEED = 1900;
const KICK_COOLDOWN = 0.15;
const SQUASH_DUR = 0.09;
const LIVES = 3;
const RETURN_DUR = 0.55;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBack = (t: number, s = 1.6) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function splitText(roots: Element[]) {
  const wrappers: HTMLSpanElement[] = [];
  const words: { word: Word; spans: HTMLSpanElement[] }[] = [];

  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest('[data-game-skip]') || !n.nodeValue?.trim()
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.nodeValue!.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.append(document.createTextNode(part));
          continue;
        }
        const w = document.createElement('span');
        const spans: HTMLSpanElement[] = [];
        for (const ch of Array.from(part)) {
          const c = document.createElement('span');
          c.textContent = ch;
          w.append(c);
          spans.push(c);
        }
        frag.append(w);
        wrappers.push(w);
        words.push({ word: { text: part, letters: [], remaining: 0 }, spans });
      }
      node.replaceWith(frag);
    }
  }

  const restore = () => {
    const parents = new Set<Node>();
    for (const w of wrappers) {
      if (!w.parentNode) continue;
      parents.add(w.parentNode);
      w.replaceWith(document.createTextNode(w.textContent ?? ''));
    }
    parents.forEach((p) => p.normalize());
  };

  return { words, restore };
}

export function startKeepyUp(dot: HTMLElement, onEnd: () => void) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const KICK_R = coarse ? 150 : 120;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${W}px`,
    height: `${H}px`,
    zIndex: '60',
    touchAction: 'none',
    cursor: 'pointer',
  });
  const ctx = canvas.getContext('2d')!;

  // --- Letters ------------------------------------------------------------
  const roots = Array.from(document.querySelectorAll('[data-game-text]'));
  const { words, restore } = splitText(roots);
  const letters: Letter[] = [];
  const metricsCache = new Map<string, TextMetrics>();
  const measure = (font: string, ch: string) => {
    const key = font + '|' + ch;
    let m = metricsCache.get(key);
    if (!m) {
      ctx.font = font;
      m = ctx.measureText(ch);
      metricsCache.set(key, m);
    }
    return m;
  };
  const baselineOf = (rect: DOMRect, m: TextMetrics) => {
    const A = m.fontBoundingBoxAscent;
    const D = m.fontBoundingBoxDescent;
    return rect.top + (rect.height - (A + D)) / 2 + A;
  };

  for (const { word, spans } of words) {
    for (const span of spans) {
      const rect = span.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom < 0 || rect.top > H) continue;
      const cs = getComputedStyle(span);
      const size = parseFloat(cs.fontSize);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const ch = span.textContent!;
      const m = measure(font, ch);
      const base = baselineOf(rect, m);
      const box: Box = {
        l: rect.left - m.actualBoundingBoxLeft,
        r: rect.left + m.actualBoundingBoxRight,
        t: base - m.actualBoundingBoxAscent,
        b: base + m.actualBoundingBoxDescent,
      };
      if (box.r - box.l < 1 || box.b - box.t < 1) continue;
      const hx = (box.l + box.r) / 2;
      const hy = (box.t + box.b) / 2;
      const L: Letter = {
        el: span,
        ch,
        font,
        color: cs.color,
        hx,
        hy,
        ox: rect.left - hx,
        oy: base - hy,
        hw: (box.r - box.l) / 2,
        hh: (box.b - box.t) / 2,
        box,
        heavy: size >= 32,
        pts: size >= 40 ? 5 : size >= 24 ? 3 : 1,
        order: 0,
        word,
        alive: true,
        x: hx,
        y: hy,
        vx: 0,
        vy: 0,
        a: 0,
        va: 0,
        alpha: 1,
        settled: false,
      };
      word.letters.push(L);
      word.remaining++;
      letters.push(L);
    }
  }

  // Inline SVG icons (nav arrows, chevron, copy icon) break loose too.
  for (const root of roots) {
    for (const svg of Array.from(root.querySelectorAll('svg'))) {
      if (svg.closest('[data-game-skip]')) continue;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > H) continue;
      const color = getComputedStyle(svg).color;
      const clone = svg.cloneNode(true) as SVGElement;
      for (const a of ['class', 'style', 'id']) clone.removeAttribute(a);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(rect.width));
      clone.setAttribute('height', String(rect.height));
      const img = new Image();
      img.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(clone.outerHTML.replaceAll('currentColor', color));
      const hw = rect.width / 2;
      const hh = rect.height / 2;
      const pad = 3; // tiny targets get a little forgiveness
      const word: Word = { text: '', letters: [], remaining: 1 };
      const L: Letter = {
        el: svg,
        img,
        ch: '',
        font: '',
        color,
        hx: rect.left + hw,
        hy: rect.top + hh,
        ox: -hw,
        oy: -hh,
        hw,
        hh,
        box: { l: rect.left - pad, r: rect.right + pad, t: rect.top - pad, b: rect.bottom + pad },
        heavy: false,
        pts: 2,
        order: 0,
        word,
        alive: true,
        x: rect.left + hw,
        y: rect.top + hh,
        vx: 0,
        vy: 0,
        a: 0,
        va: 0,
        alpha: 1,
        settled: false,
      };
      word.letters.push(L);
      letters.push(L);
    }
  }
  letters.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
  letters.forEach((l, i) => (l.order = i));

  // --- The period ---------------------------------------------------------
  // Freeze the hover lift/scale/color so we measure (and later hand back to)
  // the period's resting state.
  dot.dataset.playing = '';
  void dot.offsetWidth;
  const dotCs = getComputedStyle(dot);
  const dotFont = `${dotCs.fontStyle} ${dotCs.fontWeight} ${dotCs.fontSize} ${dotCs.fontFamily}`;
  const dm = measure(dotFont, '.');
  const dotRect = dot.getBoundingClientRect();
  // The dot is inline-block, so borrow the baseline of the letter before it.
  const prev = letters.filter((l) => dot.parentElement?.contains(l.el)).pop();
  const dotBase = prev ? prev.oy + prev.hy : dotRect.bottom - dm.fontBoundingBoxDescent;
  const glyph = {
    x: dotRect.left + (dm.actualBoundingBoxRight - dm.actualBoundingBoxLeft) / 2,
    y: dotBase - (dm.actualBoundingBoxAscent - dm.actualBoundingBoxDescent) / 2,
    r: Math.max(2, (dm.actualBoundingBoxRight + dm.actualBoundingBoxLeft) / 2),
  };
  dot.style.visibility = 'hidden';

  // --- State --------------------------------------------------------------
  type State = 'ready' | 'play' | 'ending';
  let state: State = 'ready';
  let time = 0;
  let stateT = 0;
  const ball = { x: glyph.x, y: glyph.y, vx: 0, vy: 0, r: glyph.r, squashT: 0, squashAng: 0 };
  const endFrom = { x: 0, y: 0, r: 0 };
  let lastKick = -1;
  let hitstop = 0;
  let lives = LIVES;
  const lifeLostT: number[] = [];
  let score = 0;
  let displayScore = 0;
  let combo = 0;
  let mult = 1;
  let pending = 0;
  let pendingT = 0;
  let hudAlpha = 0;
  let hintAlpha = 0;
  let kicked = false;
  // Intro: the period tips off the end of the baseline, falls, bounces on
  // the bottom edge and rests there until the first kick.
  const ROLL = 0.2;
  const ROLL_DIST = BALL_R + 3; // clear of the "e" before it grows
  const intro = { dropped: false, rested: false };
  let readySx = 1;
  let readySy = 1;
  const trail: { x: number; y: number }[] = [];
  const particles: Particle[] = [];
  const rings: Ring[] = [];
  const pops: Pop[] = [];
  const flashes: FloorFlash[] = [];

  const squash = (nx: number, ny: number) => {
    ball.squashT = SQUASH_DUR;
    ball.squashAng = Math.atan2(ny, nx);
  };

  const pop = (x: number, y: number, text: string, color = INK, size = 13) =>
    pops.push({ x, y, text, color, size, t: 0, life: 0.85 });

  function stepIntro(dt: number) {
    if (stateT < ROLL) {
      const k = stateT / ROLL;
      ball.x = glyph.x + ROLL_DIST * k * k; // accelerates toward the edge
      ball.y = glyph.y;
      ball.r = glyph.r;
      return;
    }
    if (!intro.dropped) {
      intro.dropped = true;
      ball.vx = ((2 * ROLL_DIST) / ROLL) * 0.6;
      ball.vy = 0;
    }
    ball.x = clamp(ball.x + ball.vx * dt, ball.r, W - ball.r);
    if (intro.rested) {
      ball.vx *= Math.exp(-6 * dt);
      readySx = lerp(readySx, 1, 1 - Math.exp(-14 * dt));
      readySy = lerp(readySy, 1, 1 - Math.exp(-14 * dt));
      return;
    }
    ball.r = lerp(ball.r, BALL_R, 1 - Math.exp(-10 * dt));
    ball.vy += GRAVITY * dt;
    ball.y += ball.vy * dt;
    const st = 1 + Math.min(Math.abs(ball.vy) / 6000, 0.12);
    readySx = 1 / st;
    readySy = st;
    if (ball.y > H - ball.r) {
      ball.y = H - ball.r;
      if (ball.vy > 220) {
        ball.vy = -ball.vy * 0.4;
        ball.vx *= 0.7;
        squash(0, -1);
        readySx = readySy = 1;
      } else {
        ball.vy = 0;
        ball.r = BALL_R;
        intro.rested = true;
      }
    }
  }

  // --- Input --------------------------------------------------------------
  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    if (state === 'ending' || (state === 'ready' && !intro.dropped)) return;
    const px = e.clientX;
    const py = e.clientY;
    const dx = ball.x - px;
    const dy = ball.y - py;
    const d = Math.hypot(dx, dy);
    if (d > KICK_R || time - lastKick < KICK_COOLDOWN) {
      rings.push({ x: px, y: py, r0: 4, r1: 22, t: 0, life: 0.3, color: MUTED, w: 1 });
      return;
    }
    const closeness = 1 - d / KICK_R;
    ball.vx = clamp((dx / KICK_R) * 850 + ball.vx * 0.2, -800, 800);
    ball.vy = -(880 + 200 * closeness);
    lastKick = time;
    squash(0, 1);
    rings.push({ x: ball.x, y: ball.y, r0: ball.r, r1: ball.r + 26, t: 0, life: 0.28, color: INK, w: 1.5 });
    rings.push({ x: px, y: py, r0: 2, r1: 14, t: 0, life: 0.22, color: MUTED, w: 1 });
    if (state === 'ready') {
      state = 'play';
      stateT = 0;
      ball.r = BALL_R;
      readySx = readySy = 1;
    }
    kicked = true;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') end();
  };
  // Mobile URL bars change the height constantly; only a width change
  // actually reflows the text out from under us.
  const onResize = () => {
    if (window.innerWidth !== W) end();
  };

  // --- Gameplay -----------------------------------------------------------
  function breakLetter(L: Letter) {
    L.alive = false;
    L.el.style.visibility = 'hidden';
    const dx = L.hx - ball.x;
    const dy = L.hy - ball.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = rand(180, 380) + Math.hypot(ball.vx, ball.vy) * 0.18;
    L.x = L.hx;
    L.y = L.hy;
    L.vx = (dx / d) * speed + ball.vx * 0.2;
    L.vy = (dy / d) * speed + ball.vy * 0.2 - 160;
    L.va = rand(-1, 1) * (L.heavy ? 3 : 7);
    L.a = 0;
    L.alpha = 1;
    L.settled = false;

    const n = L.heavy ? 7 : 2;
    for (let i = 0; i < n; i++) {
      const ang = Math.atan2(dy, dx) + rand(-1.1, 1.1);
      const s = rand(140, L.heavy ? 460 : 260);
      particles.push({
        x: L.hx,
        y: L.hy,
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s - 80,
        r: rand(1, L.heavy ? 2.6 : 1.8),
        color: L.color,
        t: 0,
        life: rand(0.3, 0.5),
      });
    }

    combo++;
    const newMult = Math.min(8, 1 + Math.floor(combo / 6));
    if (newMult > mult) {
      mult = newMult;
      pop(ball.x, ball.y - 22, `×${mult}`, GREEN, 15);
    }
    const gained = L.pts * mult;
    score += gained;
    pending += gained;

    if (L.heavy) hitstop = Math.max(hitstop, 0.02);

    const w = L.word;
    w.remaining--;
    if (w.remaining === 0 && w.letters.length > 1) {
      const bonus = w.letters.length * 5 * mult;
      score += bonus;
      const cx = w.letters.reduce((s, l) => s + l.hx, 0) / w.letters.length;
      const cy = Math.min(...w.letters.map((l) => l.box.t));
      const label = w.text.replace(/[^\p{L}\p{N}'’]/gu, '');
      pop(cx, cy - 6, `${label} +${bonus}`, GREEN, 14);
    }
  }

  function collide() {
    const r = ball.r;
    for (const L of letters) {
      if (!L.alive) continue;
      const b = L.box;
      if (ball.x + r < b.l || ball.x - r > b.r || ball.y + r < b.t || ball.y - r > b.b) continue;
      const cx = clamp(ball.x, b.l, b.r);
      const cy = clamp(ball.y, b.t, b.b);
      let dx = ball.x - cx;
      let dy = ball.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;

      if (L.heavy) {
        let nx: number, ny: number, push: number;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          push = r - d;
        } else {
          const pl = ball.x - b.l, pr = b.r - ball.x, pt = ball.y - b.t, pb = b.b - ball.y;
          const m = Math.min(pl, pr, pt, pb);
          nx = m === pl ? -1 : m === pr ? 1 : 0;
          ny = m === pt ? -1 : m === pb ? 1 : 0;
          if (nx !== 0) ny = 0;
          push = m + r;
        }
        ball.x += nx * push;
        ball.y += ny * push;
        const vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
          ball.vx -= 1.7 * vn * nx;
          ball.vy -= 1.7 * vn * ny;
        }
        squash(nx, ny);
      } else {
        ball.vx *= 0.985;
        ball.vy *= 0.985;
      }
      breakLetter(L);
    }
  }

  function stepBall(dt: number) {
    ball.vy += GRAVITY * dt;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) {
      ball.vx *= MAX_SPEED / sp;
      ball.vy *= MAX_SPEED / sp;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const r = ball.r;

    if (ball.x < r) {
      ball.x = r;
      ball.vx = Math.abs(ball.vx) * 0.85;
      squash(1, 0);
    } else if (ball.x > W - r) {
      ball.x = W - r;
      ball.vx = -Math.abs(ball.vx) * 0.85;
      squash(-1, 0);
    }
    if (ball.y < r) {
      ball.y = r;
      ball.vy = Math.abs(ball.vy) * 0.8;
      squash(0, 1);
    }
    if (ball.y > H - r) {
      ball.y = H - r;
      ball.vy = -850;
      ball.vx *= 0.6;
      squash(0, -1);
      floorHit();
      return;
    }
    collide();
  }

  function floorHit() {
    lives--;
    lifeLostT[lives] = 0;
    combo = 0;
    mult = 1;
    flashes.push({ x: ball.x, t: 0, life: 0.45 });
    hitstop = Math.max(hitstop, 0.03);
    if (lives <= 0) end();
  }

  function stepDebris(dt: number) {
    for (const L of letters) {
      if (L.alive || L.ret) continue;
      if (L.settled) {
        const k = Math.exp(-7 * dt);
        L.vx *= k;
        L.va *= k;
        L.x += L.vx * dt;
        L.a += L.va * dt;
        L.alpha = lerp(L.alpha, 0.35, 1 - Math.exp(-3 * dt));
        continue;
      }
      L.vy += GRAVITY * dt;
      L.x += L.vx * dt;
      L.y += L.vy * dt;
      L.a += L.va * dt;
      const ext = Math.max(L.hw, L.hh);
      if (L.x < ext) {
        L.x = ext;
        L.vx = Math.abs(L.vx) * 0.5;
      } else if (L.x > W - ext) {
        L.x = W - ext;
        L.vx = -Math.abs(L.vx) * 0.5;
      }
      const floor = H - ext;
      if (L.y > floor) {
        L.y = floor;
        if (L.vy > 0) {
          L.vy *= -0.32;
          L.vx *= 0.7;
          L.va *= 0.55;
        }
        if (Math.abs(L.vy) < 70) {
          L.vy = 0;
          L.settled = true;
        }
      }
    }
  }

  // --- Ending -------------------------------------------------------------
  function end() {
    if (state === 'ending') return;
    state = 'ending';
    stateT = 0;
    endFrom.x = ball.x;
    endFrom.y = ball.y;
    endFrom.r = ball.r;
    const dead = letters.filter((l) => !l.alive).sort((a, b) => a.order - b.order);
    const stagger = Math.min(0.45, dead.length * 0.006);
    dead.forEach((L, i) => {
      L.ret = {
        x: L.x,
        y: L.y,
        a: wrapAngle(L.a),
        alpha: L.alpha,
        delay: dead.length > 1 ? (i / (dead.length - 1)) * stagger : 0,
        done: false,
      };
    });
  }

  function stepEnding() {
    let allDone = true;
    for (const L of letters) {
      const R = L.ret;
      if (!R || R.done) continue;
      const t = (stateT - R.delay) / RETURN_DUR;
      if (t >= 1) {
        R.done = true;
        L.alive = true;
        L.el.style.visibility = '';
        continue;
      }
      allDone = false;
      if (t <= 0) continue;
      const e = easeOutBack(t, 1.3);
      L.x = lerp(R.x, L.hx, e);
      L.y = lerp(R.y, L.hy, e);
      L.a = lerp(R.a, 0, e);
      L.alpha = lerp(R.alpha, 1, Math.min(1, t * 2));
    }
    // Thrown back up: decelerate into an apex just above the period, fall
    // under gravity onto the baseline, then a damped squash anchored to the
    // baseline that settles to exactly the glyph's shape and position.
    const FLY = 0.5;
    const DROP = 0.16;
    const SETTLE = 0.2;
    const apexY = glyph.y - 34;
    let ballDone = false;
    ball.squashT = 0;
    if (stateT < FLY) {
      const k = stateT / FLY;
      const e = 1 - (1 - k) * (1 - k); // fast launch, slows into the apex
      const cx = lerp(endFrom.x, glyph.x, 0.5);
      const cy = Math.min(endFrom.y, apexY) - 90;
      const u = 1 - e;
      ball.x = u * u * endFrom.x + 2 * u * e * cx + e * e * glyph.x;
      ball.y = u * u * endFrom.y + 2 * u * e * cy + e * e * apexY;
      ball.r = lerp(endFrom.r, glyph.r, easeInOutCubic(clamp(k / 0.9, 0, 1)));
      readySx = readySy = 1;
    } else if (stateT < FLY + DROP) {
      const k = (stateT - FLY) / DROP;
      ball.x = glyph.x;
      ball.y = lerp(apexY, glyph.y, k * k); // constant acceleration
      ball.r = glyph.r;
      const st = 1 + 0.18 * k;
      readySx = 1 / st;
      readySy = st;
    } else {
      const t = stateT - FLY - DROP;
      const k = Math.min(1, t / SETTLE);
      // damped spring, forced to exactly zero at the end
      const amp = Math.exp(-t * 22) * Math.cos(t * 48) * (1 - k);
      readySy = 1 - 0.32 * amp;
      readySx = 1 + 0.26 * amp;
      ball.x = glyph.x;
      ball.r = glyph.r;
      // keep the bottom of the dot planted on the baseline
      ball.y = glyph.y + glyph.r * (1 - readySy);
      ballDone = k >= 1;
      if (ballDone) {
        readySx = readySy = 1;
        ball.y = glyph.y;
      }
    }
    ball.vx = ball.vy = 0;
    if (allDone && ballDone) cleanup();
  }

  // --- Render -------------------------------------------------------------
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // floor flashes
    for (const f of flashes) {
      const k = f.t / f.life;
      const w = 30 + 220 * easeOutBack(Math.min(1, k * 1.4), 0.6);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = INK;
      ctx.fillRect(f.x - w / 2, H - 2, w, 2);
    }
    ctx.globalAlpha = 1;

    // debris letters
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (const L of letters) {
      if (L.alive) continue;
      ctx.save();
      ctx.globalAlpha = L.alpha;
      ctx.translate(L.x, L.y);
      ctx.rotate(L.a);
      if (L.img) {
        if (L.img.complete) ctx.drawImage(L.img, L.ox, L.oy, L.hw * 2, L.hh * 2);
      } else {
        ctx.font = L.font;
        ctx.fillStyle = L.color;
        ctx.fillText(L.ch, L.ox, L.oy);
      }
      ctx.restore();
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // rings
    for (const g of rings) {
      const k = g.t / g.life;
      const e = 1 - Math.pow(1 - k, 3);
      ctx.globalAlpha = (1 - k) * 0.6;
      ctx.strokeStyle = g.color;
      ctx.lineWidth = g.w;
      ctx.beginPath();
      ctx.arc(g.x, g.y, lerp(g.r0, g.r1, e), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // trail
    if (state === 'play') {
      const n = trail.length;
      const col = mult > 1 ? '118,185,0' : '28,25,23';
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        ctx.fillStyle = `rgba(${col},${0.14 * k})`;
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, ball.r * (0.35 + 0.55 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ball
    ctx.save();
    ctx.translate(ball.x, ball.y);
    if (ball.squashT > 0) {
      const k = ball.squashT / SQUASH_DUR;
      const amt = 0.2 * k;
      ctx.rotate(ball.squashAng);
      ctx.scale(1 - amt, 1 + amt * 0.6);
    } else if (state !== 'play') {
      ctx.scale(readySx, readySy);
    } else if (state === 'play') {
      const sp = Math.hypot(ball.vx, ball.vy);
      const s = 1 + Math.min(sp / 7000, 0.12);
      ctx.rotate(Math.atan2(ball.vy, ball.vx));
      ctx.scale(s, 1 / s);
    }
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // pops
    for (const p of pops) {
      const k = p.t / p.life;
      const s = k < 0.18 ? easeOutBack(k / 0.18, 2) : 1;
      ctx.save();
      ctx.globalAlpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      ctx.translate(p.x, p.y - 38 * (1 - Math.pow(1 - k, 2)));
      ctx.scale(0.6 + 0.4 * s, 0.6 + 0.4 * s);
      ctx.font = `500 ${p.size}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }

    // HUD
    const pad = W < 640 ? 16 : 28;
    if (hudAlpha > 0.01) {
      ctx.globalAlpha = hudAlpha;
      ctx.font = `500 14px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#44403c';
      const txt = String(Math.round(displayScore));
      ctx.fillText(txt, W - pad, pad + 12);
      if (mult > 1) {
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = GREEN;
        ctx.fillText(`×${mult}`, W - pad - tw - 10, pad + 12);
      }
      for (let i = 0; i < LIVES; i++) {
        const x = W - pad - 3 - (LIVES - 1 - i) * 12;
        const y = pad + 26;
        if (i < lives) {
          ctx.fillStyle = INK;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#d6d3d1';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.stroke();
          const lt = lifeLostT[i];
          if (lt !== undefined && lt < 0.4) {
            const k = lt / 0.4;
            ctx.globalAlpha = hudAlpha * (1 - k);
            ctx.strokeStyle = INK;
            ctx.beginPath();
            ctx.arc(x, y, 3 + 9 * k, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = hudAlpha;
          }
        }
      }
    }
    if (hintAlpha > 0.01) {
      ctx.globalAlpha = hintAlpha;
      ctx.font = `400 12px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      const hint = coarse ? 'tap near the dot to keep it up' : 'click near the dot to keep it up  ·  esc to quit';
      ctx.fillText(hint, W / 2, H - 56);
    }
    ctx.globalAlpha = 1;
  }

  // --- Loop ---------------------------------------------------------------
  let raf = 0;
  let last = performance.now();

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    // timers that run through hitstop
    const showHud = state !== 'ending' && kicked;
    hudAlpha = lerp(hudAlpha, showHud ? 1 : 0, 1 - Math.exp(-10 * dt));
    hintAlpha = lerp(hintAlpha, state === 'ready' && intro.rested ? 1 : 0, 1 - Math.exp(-(kicked ? 14 : 5) * dt));

    let sdt = dt;
    if (hitstop > 0) {
      const used = Math.min(hitstop, dt);
      hitstop -= used;
      sdt = dt - used;
    }

    if (sdt > 0) {
      time += sdt;
      stateT += sdt;
      for (let i = 0; i < lifeLostT.length; i++) if (lifeLostT[i] !== undefined) lifeLostT[i] += sdt;
      if (ball.squashT > 0) ball.squashT = Math.max(0, ball.squashT - sdt);

      if (state === 'ready') {
        stepIntro(sdt);
      } else if (state === 'play') {
        const steps = Math.ceil(sdt * 240);
        const h = sdt / steps;
        for (let i = 0; i < steps && state === 'play'; i++) stepBall(h);
        trail.push({ x: ball.x, y: ball.y });
        if (trail.length > 10) trail.shift();
      } else {
        trail.length = 0;
        stepEnding();
      }

      stepDebris(sdt);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.t += sdt;
        if (p.t >= p.life) { particles.splice(i, 1); continue; }
        p.vy += GRAVITY * 0.6 * sdt;
        p.vx *= Math.exp(-3 * sdt);
        p.x += p.vx * sdt;
        p.y += p.vy * sdt;
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].t += sdt;
        if (rings[i].t >= rings[i].life) rings.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += sdt;
        if (pops[i].t >= pops[i].life) pops.splice(i, 1);
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].t += sdt;
        if (flashes[i].t >= flashes[i].life) flashes.splice(i, 1);
      }

      pendingT += sdt;
      if (pending > 0 && pendingT > 0.14 && state === 'play') {
        pop(ball.x, ball.y - 20, `+${pending}`, mult > 1 ? GREEN : INK, 12);
        pending = 0;
        pendingT = 0;
      }
      displayScore = lerp(displayScore, score, 1 - Math.exp(-14 * sdt));
      if (Math.abs(score - displayScore) < 0.5) displayScore = score;
    }

    render();
    if (raf) raf = requestAnimationFrame(frame);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    raf = 0;
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    canvas.remove();
    document.documentElement.style.overflow = prevOverflow;
    for (const L of letters) L.el.style.visibility = '';
    restore();
    dot.style.visibility = '';
    // Keep the hover lift/green suppressed until the pointer is really off the
    // period. (:hover is stale right after the overlay goes away, so wait for
    // an actual pointer move to decide.)
    const onMove = () => {
      if (dot.matches(':hover')) return;
      delete dot.dataset.playing;
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    onEnd();
  }

  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.append(canvas);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(frame);
}
