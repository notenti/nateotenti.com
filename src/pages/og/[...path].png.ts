// Social share cards (Open Graph / Twitter), rendered to PNG at build time.
// BaseLayout points og:image at /og/<path>.png for each page.
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const WIDTH = 1200;
const HEIGHT = 630;
const INK = '#171717';

// Allo, instanced from the variable font: satori can't read woff2 or variable axes.
// Read from the project root: once bundled, import.meta.url no longer points into src/.
const fontDir = join(process.cwd(), 'src/assets/og');
const fonts = await Promise.all(
  ([[400, 400], [500, 500], [650, 600]] as const).map(async ([file, weight]) => ({
    name: 'Allo',
    // The 650 instance is registered as 600: satori only takes weights in steps of 100.
    weight,
    style: 'normal' as const,
    data: await readFile(join(fontDir, `Allo-${file}.ttf`)),
  })),
);

// The blob from the favicon (32×32 viewBox).
const BLOB =
  'M6.44 4.78C7.43 4.07 8.55 3.52 9.64 3.05C10.74 2.58 11.86 2.2 13.01 1.96C14.15 1.73 15.34 1.58 16.51 1.65C17.68 1.72 18.9 1.96 20.03 2.4C21.16 2.83 22.26 3.49 23.28 4.24C24.3 5 25.27 5.92 26.14 6.93C27.02 7.94 27.87 9.09 28.52 10.3C29.17 11.51 29.71 12.88 30.04 14.19C30.37 15.5 30.49 16.89 30.5 18.17C30.51 19.45 30.37 20.72 30.12 21.88C29.87 23.05 29.51 24.18 29 25.18C28.49 26.18 27.84 27.11 27.06 27.86C26.27 28.61 25.32 29.24 24.28 29.66C23.24 30.08 22.02 30.31 20.81 30.35C19.6 30.39 18.27 30.19 17.02 29.9C15.76 29.61 14.49 29.12 13.27 28.6C12.06 28.09 10.85 27.51 9.72 26.82C8.59 26.14 7.44 25.38 6.48 24.49C5.51 23.6 4.63 22.57 3.92 21.51C3.21 20.44 2.64 19.27 2.24 18.08C1.83 16.9 1.55 15.63 1.5 14.4C1.45 13.17 1.57 11.85 1.94 10.67C2.3 9.5 2.94 8.31 3.69 7.33C4.44 6.35 5.45 5.5 6.44 4.78Z';

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

const blob = (size: number, style: Record<string, unknown> = {}) => ({
  type: 'svg',
  props: {
    width: size,
    height: size,
    viewBox: '0 0 32 32',
    style,
    children: { type: 'path', props: { d: BLOB, fill: INK } },
  },
});

const page = (...children: unknown[]) =>
  h(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      display: 'flex',
      position: 'relative',
      backgroundColor: '#ffffff',
      color: INK,
      fontFamily: 'Allo',
      overflow: 'hidden',
    },
    ...children,
  );

const footer = (text: string) =>
  h('div', { fontSize: 26, fontWeight: 500, letterSpacing: '-0.01em' }, text);

const textColumn = (children: unknown[], width = WIDTH) =>
  h(
    'div',
    {
      // Sized inside the margin: satori lays out padding as content-box.
      width: width - 160,
      height: HEIGHT - 160,
      margin: 80,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    },
    ...children,
  );

function homeCard() {
  return page(
    blob(380, { position: 'absolute', right: -70, bottom: -90 }),
    textColumn([
      h(
        'div',
        { display: 'flex', flexDirection: 'column', marginTop: 40 },
        h('div', { fontSize: 104, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1 }, "Hi, I'm Nate."),
        h(
          'div',
          { fontSize: 48, fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.2, marginTop: 32, maxWidth: 820 },
          "I'm a software engineer working at NVIDIA.",
        ),
      ),
      footer('nateotenti.com'),
    ]),
  );
}

function titleCard(title: string, subtitle: string) {
  return page(
    blob(380, { position: 'absolute', right: -70, bottom: -90 }),
    textColumn([
      h(
        'div',
        { display: 'flex', flexDirection: 'column', marginTop: 40 },
        h('div', { fontSize: 104, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1 }, title),
        h('div', { fontSize: 48, fontWeight: 400, letterSpacing: '-0.02em', marginTop: 32 }, subtitle),
      ),
      footer('nateotenti.com'),
    ]),
  );
}

async function imageDataUri(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OG cover fetch failed (${res.status}): ${url}`);
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  const data = Buffer.from(await res.arrayBuffer()).toString('base64');
  return `data:${type};base64,${data}`;
}

const formatDate = (date: Date) =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' });

async function postCard(title: string, date: Date, location: string, cover?: string) {
  const photoWidth = 520;
  const textWidth = cover ? WIDTH - photoWidth : WIDTH;
  return page(
    textColumn(
      [
        h(
          'div',
          { display: 'flex', flexDirection: 'column', marginTop: 40 },
          h(
            'div',
            { fontSize: title.length > 14 ? 76 : 92, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.02 },
            title,
          ),
          h(
            'div',
            { fontSize: 34, fontWeight: 400, letterSpacing: '-0.01em', marginTop: 28 },
            `${formatDate(date)} · ${location}`,
          ),
        ),
        footer('nateotenti.com/life'),
      ],
      textWidth,
    ),
    cover
      ? {
          type: 'img',
          props: {
            src: await imageDataUri(cover),
            width: photoWidth,
            height: HEIGHT,
            style: { width: photoWidth, height: HEIGHT, objectFit: 'cover' },
          },
        }
      : blob(380, { position: 'absolute', right: -70, bottom: -90 }),
  );
}

export const getStaticPaths = (async () => {
  const posts = await getCollection('life', ({ data }) => !data.draft);
  return [
    { params: { path: 'index' }, props: { kind: 'home' as const } },
    { params: { path: 'life' }, props: { kind: 'life' as const } },
    ...posts.map((post) => ({
      params: { path: `life/${post.slug}` },
      props: { kind: 'post' as const, post },
    })),
  ];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  let node: Node;
  if (props.kind === 'post') {
    const { data } = props.post;
    node = await postCard(data.title, data.date, data.location, data.type === 'album' ? data.cover : undefined);
  } else if (props.kind === 'life') {
    node = titleCard('Life', 'Photos and thoughts.');
  } else {
    node = homeCard();
  }

  const svg = await satori(node as never, { width: WIDTH, height: HEIGHT, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
};
