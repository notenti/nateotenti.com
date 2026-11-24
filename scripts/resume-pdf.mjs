// Prints /resume to public/resume.pdf with headless Chrome.
// Run via `npm run resume:pdf`, which builds the site first.
// Set CHROME_PATH if Chrome isn't at the default macOS location.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../public/resume.pdf', import.meta.url));
const port = 4329;
const chrome =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}. Set CHROME_PATH.`);
  process.exit(1);
}

const server = spawn('npx', ['astro', 'preview', '--port', String(port)], {
  cwd: root,
  stdio: 'ignore',
});

try {
  const url = `http://localhost:${port}/resume`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (i > 60) throw new Error('Preview server did not start');
    await new Promise((r) => setTimeout(r, 250));
  }

  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--virtual-time-budget=3000',
    `--print-to-pdf=${out}`,
    url,
  ], { stdio: 'ignore' });

  console.log(`Wrote ${out}`);
} finally {
  server.kill();
}
