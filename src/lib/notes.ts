// Inline notes in plain-text fields such as an album's `intro`:
//   "We hiked [[the whole ridge|It was more like half of it.]] before lunch."
// The phrase is highlighted on the page and clicking it shows the note.

const NOTE = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;

export type Segment = { text: string; note?: string };

export function splitNotes(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(NOTE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1].trim(), note: m[2].trim() });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The text without note markup, for meta descriptions and other plain contexts. */
export function stripNotes(text: string): string;
export function stripNotes(text: string | undefined): string | undefined;
export function stripNotes(text: string | undefined) {
  return text?.replace(NOTE, (_, phrase: string) => phrase.trim());
}
