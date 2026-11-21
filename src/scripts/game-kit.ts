// Shared pieces for the hidden minigames: a full-screen canvas overlay, and
// turning the page's text (and inline icons) into measurable, drawable glyphs
// without shifting the layout.

export type Box = { l: number; t: number; r: number; b: number };

export interface GlyphWord {
  text: string;
  glyphs: Glyph[];
}

export interface Glyph {
  el: HTMLElement | SVGElement;
  img?: HTMLImageElement;
  ch: string;
  font: string;
  color: string;
  size: number;
  // home pivot (ink center) and draw offset from pivot to baseline-left
  hx: number;
  hy: number;
  ox: number;
  oy: number;
  hw: number;
  hh: number;
  box: Box;
  word: GlyphWord;
}

export const INK = '#1c1917';
export const GREEN = '#76b900';
export const MUTED = '#a8a29e';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOutBack = (t: number, s = 1.6) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Exponential smoothing factor for a rate, independent of frame time. */
export const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function createOverlay() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
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
  });
  const ctx = canvas.getContext('2d')!;
  let prevOverflow = '';
  return {
    canvas,
    ctx,
    W,
    H,
    dpr,
    coarse,
    mount() {
      prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      document.body.append(canvas);
    },
    unmount() {
      canvas.remove();
      document.documentElement.style.overflow = prevOverflow;
    },
    clear() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
    },
  };
}

function splitText(roots: Element[]) {
  const wrappers: HTMLSpanElement[] = [];
  const words: { text: string; spans: HTMLSpanElement[] }[] = [];

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
        words.push({ text: part, spans });
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

/**
 * Split every `[data-game-text]` root into per-character spans and measure
 * each glyph's ink box. Inline SVG icons inside those roots come along as
 * image glyphs. Call `restore()` when done to put the text nodes back.
 */
export function collectGlyphs(ctx: CanvasRenderingContext2D, H: number) {
  const roots = Array.from(document.querySelectorAll('[data-game-text]'));
  const split = splitText(roots);
  const glyphs: Glyph[] = [];
  const words: GlyphWord[] = [];
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

  for (const { text, spans } of split.words) {
    const word: GlyphWord = { text, glyphs: [] };
    for (const span of spans) {
      const rect = span.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom < 0 || rect.top > H) continue;
      const cs = getComputedStyle(span);
      const size = parseFloat(cs.fontSize);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const ch = span.textContent!;
      const m = measure(font, ch);
      const A = m.fontBoundingBoxAscent;
      const D = m.fontBoundingBoxDescent;
      const base = rect.top + (rect.height - (A + D)) / 2 + A;
      const box: Box = {
        l: rect.left - m.actualBoundingBoxLeft,
        r: rect.left + m.actualBoundingBoxRight,
        t: base - m.actualBoundingBoxAscent,
        b: base + m.actualBoundingBoxDescent,
      };
      if (box.r - box.l < 1 || box.b - box.t < 1) continue;
      const hx = (box.l + box.r) / 2;
      const hy = (box.t + box.b) / 2;
      const g: Glyph = {
        el: span,
        ch,
        font,
        color: cs.color,
        size,
        hx,
        hy,
        ox: rect.left - hx,
        oy: base - hy,
        hw: (box.r - box.l) / 2,
        hh: (box.b - box.t) / 2,
        box,
        word,
      };
      word.glyphs.push(g);
      glyphs.push(g);
    }
    if (word.glyphs.length) words.push(word);
  }

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
      const word: GlyphWord = { text: '', glyphs: [] };
      const g: Glyph = {
        el: svg,
        img,
        ch: '',
        font: '',
        color,
        size: rect.height,
        hx: rect.left + hw,
        hy: rect.top + hh,
        ox: -hw,
        oy: -hh,
        hw,
        hh,
        box: { l: rect.left - pad, r: rect.right + pad, t: rect.top - pad, b: rect.bottom + pad },
        word,
      };
      word.glyphs.push(g);
      words.push(word);
      glyphs.push(g);
    }
  }

  glyphs.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  return { glyphs, words, measure, restore: split.restore };
}

/** Draw a glyph with its ink center at (x, y). */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  g: Omit<Glyph, 'word'>,
  x: number,
  y: number,
  a = 0,
  alpha = 1,
  scale = 1
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (a) ctx.rotate(a);
  if (scale !== 1) ctx.scale(scale, scale);
  if (g.img) {
    if (g.img.complete) ctx.drawImage(g.img, g.ox, g.oy, g.hw * 2, g.hh * 2);
  } else {
    ctx.font = g.font;
    ctx.fillStyle = g.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(g.ch, g.ox, g.oy);
  }
  ctx.restore();
}

/** Circle vs box: returns push-out normal and depth, or null. */
export function circleBox(x: number, y: number, r: number, b: Box) {
  if (x + r < b.l || x - r > b.r || y + r < b.t || y - r > b.b) return null;
  const cx = clamp(x, b.l, b.r);
  const cy = clamp(y, b.t, b.b);
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  const pl = x - b.l, pr = b.r - x, pt = y - b.t, pb = b.b - y;
  const m = Math.min(pl, pr, pt, pb);
  let nx = m === pl ? -1 : m === pr ? 1 : 0;
  const ny = nx === 0 ? (m === pt ? -1 : 1) : 0;
  if (nx === 0 && ny === 0) nx = 1;
  return { nx, ny, depth: m + r };
}
