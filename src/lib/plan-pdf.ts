/**
 * Renders a generated plan into a branded PDF for the customer's email.
 *
 * Built with pdf-lib rather than a headless browser. Chromium on a
 * serverless function is slow to cold-start and large, and plan generation
 * already runs for minutes against the function timeout; adding a browser to
 * that path is how you turn a slow request into a failed one. pdf-lib is
 * pure JavaScript and draws in milliseconds.
 *
 * pdf-lib has no layout engine, so everything here is laid out by hand. It
 * handles the markdown the plan prompts ask for: # sections, ## weeks,
 * **Label:** runs, bullets, numbered lists, tables, blockquotes and rules.
 * Anything unrecognised is drawn as body text rather than dropped, so a
 * customer never receives a PDF with content silently missing.
 *
 * Layout:
 *   - a cover page with the logo, title, who it is for, and a contents list
 *     with page numbers (drawn last, once the page numbers are known)
 *   - every # section starts a new page, and so does every week of the
 *     week-by-week plan, matching the one-week-per-page print view on the site
 *   - tables are real tables, with a tick column on the daily practice table
 *     so a printed plan can be ticked off by hand
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';

// Brand colours, matching the site.
const PURPLE = rgb(0x69 / 255, 0x00 / 255, 0x5a / 255);
const PURPLE_LIGHT = rgb(0xf0 / 255, 0xcd / 255, 0xff / 255);
const LILAC = rgb(0xf9 / 255, 0xef / 255, 0xfd / 255);
const LIME = rgb(0xc0 / 255, 0xfe / 255, 0x71 / 255);
// Lime is too pale to carry text or thin marks on white, so small marks
// (bullets, numbers, the eyebrow) use this deeper green instead.
const LIME_DEEP = rgb(0x4a / 255, 0x6b / 255, 0x10 / 255);
const INK = rgb(0x1a / 255, 0x1a / 255, 0x1a / 255);
const GREY = rgb(0.4, 0.4, 0.4);
const WHITE = rgb(1, 1, 1);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const WIDTH = A4[0] - MARGIN * 2;
// Content pages carry a running header, so text starts below it.
const TOP = A4[1] - 84;
const BOTTOM = 64;

const BODY = 10.5;

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

type Ctx = Fonts & {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  title: string;
  // Filled as sections are drawn, then used for the cover's contents list.
  contents: Array<{ label: string; pageIndex: number; level: 1 | 2 }>;
  section: string;
  safe: (s: string) => string;
};

type Run = { text: string; bold: boolean; italic: boolean };

// ── Text safety ────────────────────────────────────────────────────────────
// The standard PDF fonts only cover WinAnsi. One arrow or tick from the model
// used to make pdf-lib throw, and the customer got their email with no PDF.
// Common ones are swapped for a plain equivalent; anything else unencodable
// is dropped rather than allowed to fail the whole document.
const SWAPS: Record<string, string> = {
  '→': '->', '←': '<-', '↑': '^', '↓': 'v',
  '✓': '-', '✔': '-', '✅': '-', '✗': 'x', '❌': 'x',
  '≥': '>=', '≤': '<=', '≠': '!=', '×': 'x',
  '‑': '-', '‐': '-', '−': '-', ' ': ' ', ' ': ' ', ' ': ' ',
  '′': "'", '″': '"',
};

function makeSafe(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (s: string) => {
    let out = '';
    for (const ch of s) {
      const swap = SWAPS[ch];
      if (swap !== undefined) { out += swap; continue; }
      if (ch === '\t') { out += ' '; continue; }
      if (supported.has(ch.codePointAt(0)!)) out += ch;
    }
    return out;
  };
}

// ── Inline markdown ────────────────────────────────────────────────────────
/** Splits a line into bold / italic / plain runs, dropping the markers. */
function parseRuns(line: string): Run[] {
  const text = line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
  const runs: Run[] = [];
  const re = /\*\*(.+?)\*\*|(?:^|(?<=\s))\*(?!\s)(.+?)\*(?=\s|$|[.,;:!?)])|__(.+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false, italic: false });
    if (m[1] !== undefined || m[3] !== undefined) runs.push({ text: m[1] ?? m[3], bold: true, italic: false });
    else runs.push({ text: m[2], bold: false, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false, italic: false });
  return runs.filter((r) => r.text.length);
}

function plain(line: string): string {
  return parseRuns(line).map((r) => r.text).join('').trim();
}

/** "HOW TO READ THIS PLAN" -> "How to read this plan". Mixed case is left alone. */
function sentenceCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters || letters !== letters.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ── Pages ──────────────────────────────────────────────────────────────────
function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage(A4);
  ctx.y = TOP;
  // Running header, so a loose printed page still says what it belongs to.
  const hy = A4[1] - 44;
  ctx.page.drawText('MIND THE GAEL', { x: MARGIN, y: hy, size: 8, font: ctx.bold, color: LIME_DEEP });
  const t = ctx.safe(ctx.title);
  const tw = ctx.regular.widthOfTextAtSize(t, 8);
  ctx.page.drawText(t, { x: MARGIN + WIDTH - tw, y: hy, size: 8, font: ctx.regular, color: GREY });
  ctx.page.drawLine({
    start: { x: MARGIN, y: hy - 8 },
    end: { x: MARGIN + WIDTH, y: hy - 8 },
    thickness: 0.75,
    color: PURPLE,
  });
}

function room(ctx: Ctx, needed: number) {
  if (ctx.y - needed < BOTTOM) newPage(ctx);
}

/** True once anything beyond `allowance` points has been drawn on this page. */
function pageUsed(ctx: Ctx, allowance = 4) {
  return TOP - ctx.y > allowance;
}

function fontFor(ctx: Fonts, r: { bold: boolean; italic: boolean }) {
  return r.bold ? ctx.bold : r.italic ? ctx.italic : ctx.regular;
}

// ── Wrapping ───────────────────────────────────────────────────────────────
// `lead` is the space before the word. It is kept as a measured gap rather
// than a leading space character, because some PDF viewers drop leading
// spaces at the start of a text run and the words ran together.
type Word = { text: string; bold: boolean; italic: boolean; width: number; lead?: number };
type Line = { words: Word[]; width: number };

function wrapRuns(ctx: Ctx, runs: Run[], size: number, maxWidth: number): Line[] {
  const words: Word[] = [];
  for (const r of runs) {
    const font = fontFor(ctx, r);
    // Keep track of where a run touches its neighbour with no space, so
    // "**Focus:**word" does not gain a space it never had.
    const parts = ctx.safe(r.text).split(/(\s+)/);
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { words.push({ text: ' ', bold: false, italic: false, width: 0 }); continue; }
      words.push({ text: p, bold: r.bold, italic: r.italic, width: font.widthOfTextAtSize(p, size) });
    }
  }
  const space = ctx.regular.widthOfTextAtSize(' ', size);
  const lines: Line[] = [];
  let cur: Line = { words: [], width: 0 };
  let pendingSpace = false;
  const push = () => { if (cur.words.length) lines.push(cur); cur = { words: [], width: 0 }; };

  for (const w of words) {
    if (w.text === ' ') { pendingSpace = cur.words.length > 0; continue; }
    const gap = pendingSpace ? space : 0;
    if (cur.words.length && cur.width + gap + w.width > maxWidth) {
      push();
      pendingSpace = false;
    }
    // A single word wider than the line is broken by character.
    if (w.width > maxWidth) {
      const font = fontFor(ctx, w);
      let chunk = '';
      for (const ch of w.text) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
          cur.words.push({ ...w, text: chunk, width: font.widthOfTextAtSize(chunk, size) });
          push();
          chunk = ch;
        } else chunk += ch;
      }
      w.text = chunk;
      w.width = font.widthOfTextAtSize(chunk, size);
    }
    const g = pendingSpace && cur.words.length ? space : 0;
    cur.words.push({ ...w, lead: g, width: w.width + g });
    cur.width += w.width + g;
    pendingSpace = false;
  }
  push();
  return lines.length ? lines : [{ words: [], width: 0 }];
}

function drawLine(ctx: Ctx, line: Line, x: number, y: number, size: number, color: RGB, boldColor?: RGB) {
  let cx = x;
  for (const w of line.words) {
    const font = fontFor(ctx, w);
    cx += w.lead ?? 0;
    ctx.page.drawText(w.text, { x: cx, y, size, font, color: w.bold && boldColor ? boldColor : color });
    cx += font.widthOfTextAtSize(w.text, size);
  }
}

/** Draws a wrapped paragraph of runs. Bold runs are purple, like the site's labels. */
function paragraph(
  ctx: Ctx,
  runs: Run[],
  opts: { size?: number; indent?: number; color?: RGB; boldColor?: RGB; after?: number; leading?: number } = {},
) {
  const size = opts.size ?? BODY;
  const indent = opts.indent ?? 0;
  const leading = size * (opts.leading ?? 1.5);
  const lines = wrapRuns(ctx, runs, size, WIDTH - indent);
  lines.forEach((line) => {
    room(ctx, leading);
    drawLine(ctx, line, MARGIN + indent, ctx.y - size, size, opts.color ?? INK, opts.boldColor ?? PURPLE);
    ctx.y -= leading;
  });
  ctx.y -= opts.after ?? 0;
  return lines.length;
}

// ── Shapes ─────────────────────────────────────────────────────────────────
function roundedRect(page: PDFPage, x: number, yTop: number, w: number, h: number, r: number, color: RGB) {
  const rr = Math.min(r, h / 2, w / 2);
  const path =
    `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} ` +
    `A ${rr} ${rr} 0 0 1 ${w - rr} ${h} H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} ` +
    `V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
  page.drawSvgPath(path, { x, y: yTop, color, borderWidth: 0 });
}

/** Lime pill with dark text, the site's eyebrow. */
function pill(ctx: Ctx, page: PDFPage, text: string, x: number, yTop: number, size = 8.5) {
  const t = ctx.safe(text.toUpperCase());
  const w = ctx.bold.widthOfTextAtSize(t, size) + t.length * 0.9 + 22;
  const h = size + 12;
  roundedRect(page, x, yTop, w, h, h / 2, LIME);
  page.drawText(t, {
    x: x + 11, y: yTop - h + 7.2, size, font: ctx.bold, color: rgb(0.01, 0.04, 0.02),
    // pdf-lib has no letter-spacing, so the tracking above is approximated
    // by widening the pill and drawing the text as-is.
  });
  return w;
}

// ── Headings ───────────────────────────────────────────────────────────────
function sectionHeading(ctx: Ctx, text: string) {
  if (pageUsed(ctx)) newPage(ctx);
  const label = sentenceCase(plain(text));
  ctx.section = label.toLowerCase();
  ctx.contents.push({ label, pageIndex: ctx.doc.getPageCount() - 1, level: 1 });
  const lines = wrapRuns(ctx, [{ text: label, bold: true, italic: false }], 22, WIDTH);
  for (const line of lines) {
    drawLine(ctx, line, MARGIN, ctx.y - 22, 22, PURPLE, PURPLE);
    ctx.y -= 28;
  }
  // Short lime bar under the heading, echoing the site's section headings.
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 4, width: 48, height: 4, color: LIME });
  ctx.y -= 22;
}

/** A week of the week-by-week plan: its own page, under a purple band. */
function weekHeading(ctx: Ctx, text: string) {
  if (pageUsed(ctx, 90)) newPage(ctx);
  const label = plain(text);
  ctx.contents.push({ label, pageIndex: ctx.doc.getPageCount() - 1, level: 2 });
  const lines = wrapRuns(ctx, [{ text: label, bold: true, italic: false }], 15, WIDTH - 32);
  const h = lines.length * 20 + 20;
  roundedRect(ctx.page, MARGIN, ctx.y, WIDTH, h, 10, PURPLE);
  let ty = ctx.y - 10;
  for (const line of lines) {
    drawLine(ctx, line, MARGIN + 16, ty - 15, 15, WHITE, WHITE);
    ty -= 20;
  }
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - h - 3, width: WIDTH, height: 3, color: LIME });
  ctx.y -= h + 20;
}

function subHeading(ctx: Ctx, text: string, level: number) {
  const size = level === 2 ? 14 : 12;
  ctx.y -= level === 2 ? 10 : 6;
  room(ctx, size * 2 + 30); // keep a heading with at least a line of what follows
  paragraph(ctx, [{ text: sentenceCase(plain(text)), bold: true, italic: false }], { size, after: level === 2 ? 4 : 2, leading: 1.3 });
  if (level === 2) {
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y + 2 }, end: { x: MARGIN + WIDTH, y: ctx.y + 2 }, thickness: 0.75, color: PURPLE_LIGHT });
    ctx.y -= 6;
  }
}

// ── Lists, quotes, rules ───────────────────────────────────────────────────
function listItem(ctx: Ctx, marker: string, body: string, depth: number, numbered: boolean) {
  const indent = 18 + depth * 16;
  const size = BODY;
  room(ctx, size * 1.5);
  const mx = MARGIN + indent - (numbered ? 16 : 11);
  if (numbered) {
    ctx.page.drawText(ctx.safe(marker), { x: mx, y: ctx.y - size, size, font: ctx.bold, color: PURPLE });
  } else {
    ctx.page.drawCircle({ x: mx + 2, y: ctx.y - size + 3.4, size: 2, color: depth ? PURPLE : LIME_DEEP });
  }
  paragraph(ctx, parseRuns(body), { indent, after: 3 });
}

function blockquote(ctx: Ctx, body: string) {
  const size = BODY;
  const leading = size * 1.5;
  const lines = wrapRuns(ctx, parseRuns(body), size, WIDTH - 26);
  for (const line of lines) {
    room(ctx, leading);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - leading, width: WIDTH, height: leading, color: LILAC });
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - leading, width: 3.5, height: leading, color: PURPLE });
    drawLine(ctx, line, MARGIN + 16, ctx.y - size - 2, size, INK, PURPLE);
    ctx.y -= leading;
  }
  ctx.y -= 6;
}

function rule(ctx: Ctx) {
  ctx.y -= 6;
  room(ctx, 12);
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + WIDTH, y: ctx.y }, thickness: 0.75, color: PURPLE_LIGHT });
  ctx.y -= 12;
}

// ── Tables ─────────────────────────────────────────────────────────────────
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => ctx_plain(c));
}
const ctx_plain = (c: string) => plain(c.trim());

function table(ctx: Ctx, rows: string[][]) {
  if (!rows.length) return;
  const header = rows[0];
  const body = rows.slice(1);
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
  const size = 9.5;
  const pad = 6;
  const leading = size * 1.4;

  // The daily practice table (first column "Day") gets a tick box column,
  // the paper version of ticking the row off on the dashboard.
  const tick = /^day$/i.test(header[0]?.trim() || '');
  const tickW = tick ? 34 : 0;
  const avail = WIDTH - tickW;

  // Column widths: natural width where it fits, otherwise share the spare
  // room in proportion to how much each column wants beyond its longest word.
  const all = [norm(header), ...body.map(norm)];
  const natural = Array.from({ length: cols }, (_, i) =>
    Math.max(...all.map((r, ri) => (ri === 0 ? ctx.bold : ctx.regular).widthOfTextAtSize(ctx.safe(r[i]), size))) + pad * 2,
  );
  const minW = Array.from({ length: cols }, (_, i) =>
    Math.max(
      36,
      ...all.map((r, ri) =>
        Math.max(0, ...ctx.safe(r[i]).split(/\s+/).map((w) => (ri === 0 ? ctx.bold : ctx.regular).widthOfTextAtSize(w, size))),
      ),
    ) + pad * 2,
  );
  let widths: number[];
  const natSum = natural.reduce((a, b) => a + b, 0);
  const minSum = minW.reduce((a, b) => a + b, 0);
  if (natSum <= avail) {
    widths = natural.map((w) => (w / natSum) * avail);
  } else if (minSum <= avail) {
    const want = natural.map((n, i) => n - minW[i]);
    const wantSum = want.reduce((a, b) => a + b, 0) || 1;
    widths = minW.map((m, i) => m + (want[i] / wantSum) * (avail - minSum));
  } else {
    widths = minW.map((m) => (m / minSum) * avail);
  }

  const cellLines = (r: string[], bold: boolean) =>
    norm(r).map((c, i) => wrapRuns(ctx, [{ text: c, bold, italic: false }], size, widths[i] - pad * 2));

  const drawRow = (r: string[], isHeader: boolean, shade: boolean) => {
    const lines = cellLines(r, isHeader);
    const h = Math.max(...lines.map((l) => l.length)) * leading + pad * 2 - 2;
    let x = MARGIN;
    const top = ctx.y;
    const fill = isHeader ? PURPLE : shade ? LILAC : WHITE;
    ctx.page.drawRectangle({ x: MARGIN, y: top - h, width: WIDTH, height: h, color: fill });
    lines.forEach((cl, i) => {
      let ty = top - pad - size + 1;
      for (const line of cl) {
        drawLine(ctx, line, x + pad, ty, size, isHeader ? WHITE : INK, isHeader ? WHITE : PURPLE);
        ty -= leading;
      }
      x += widths[i];
      if (i < cols - 1 || tick) {
        ctx.page.drawLine({ start: { x, y: top }, end: { x, y: top - h }, thickness: 0.5, color: PURPLE_LIGHT });
      }
    });
    if (tick) {
      if (isHeader) {
        const t = 'Done';
        ctx.page.drawText(t, { x: x + (tickW - ctx.bold.widthOfTextAtSize(t, 8)) / 2, y: top - pad - size + 1, size: 8, font: ctx.bold, color: WHITE });
      } else {
        const b = 10;
        ctx.page.drawRectangle({ x: x + (tickW - b) / 2, y: top - h / 2 - b / 2, width: b, height: b, borderColor: PURPLE, borderWidth: 1, color: WHITE });
      }
    }
    ctx.page.drawLine({ start: { x: MARGIN, y: top - h }, end: { x: MARGIN + WIDTH, y: top - h }, thickness: 0.5, color: PURPLE_LIGHT });
    ctx.y -= h;
    return h;
  };

  const rowHeight = (r: string[], isHeader: boolean) =>
    Math.max(...cellLines(r, isHeader).map((l) => l.length)) * leading + pad * 2 - 2;

  ctx.y -= 4;
  room(ctx, rowHeight(header, true) + (body[0] ? rowHeight(body[0], false) : 0));
  let tableTop = ctx.y;
  drawRow(header, true, false);
  body.forEach((r, i) => {
    const h = rowHeight(r, false);
    if (ctx.y - h < BOTTOM) {
      // Close the frame on this page, then repeat the header on the next.
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: WIDTH, height: tableTop - ctx.y, borderColor: PURPLE, borderWidth: 1 });
      newPage(ctx);
      tableTop = ctx.y;
      drawRow(header, true, false);
    }
    drawRow(r, false, i % 2 === 1);
  });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y, width: WIDTH, height: tableTop - ctx.y, borderColor: PURPLE, borderWidth: 1 });
  ctx.y -= 12;
}

// ── Cover ──────────────────────────────────────────────────────────────────
async function drawCover(ctx: Ctx, opts: { title: string; clientName?: string; date: Date; logoPng?: Uint8Array }) {
  const page = ctx.doc.insertPage(0, A4);
  // drawLine and wrapRuns draw on ctx.page, which is still the last content
  // page at this point. Point it at the cover until the cover is done.
  const saved = ctx.page;
  ctx.page = page;
  let y = A4[1] - 60;

  if (opts.logoPng) {
    try {
      const img = await ctx.doc.embedPng(opts.logoPng);
      const w = 150;
      const h = (img.height / img.width) * w;
      page.drawImage(img, { x: MARGIN - 6, y: y - h, width: w, height: h });
      y -= h + 36;
    } catch {
      y -= 10;
    }
  }
  if (!opts.logoPng) {
    page.drawText('MIND THE GAEL', { x: MARGIN, y: y - 12, size: 12, font: ctx.bold, color: PURPLE });
    y -= 50;
  }

  pill(ctx, page, 'Your plan', MARGIN, y);
  y -= 44;

  const titleLines = wrapRuns(ctx, [{ text: opts.title, bold: true, italic: false }], 32, WIDTH);
  for (const line of titleLines) {
    drawLine(ctx, { ...line }, MARGIN, y - 32, 32, PURPLE, PURPLE);
    y -= 38;
  }
  y -= 6;
  const date = opts.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const who = opts.clientName ? `Prepared for ${opts.clientName}  ·  ${date}` : date;
  page.drawText(ctx.safe(who), { x: MARGIN, y: y - 12, size: 12, font: ctx.regular, color: GREY });
  y -= 34;
  page.drawRectangle({ x: MARGIN, y, width: WIDTH, height: 1, color: PURPLE });
  y -= 30;

  // Contents, now that every section knows its page.
  if (ctx.contents.length) {
    page.drawText('Inside this plan', { x: MARGIN, y: y - 14, size: 14, font: ctx.bold, color: PURPLE });
    y -= 30;
    for (const c of ctx.contents) {
      if (y < 190) break;
      const size = c.level === 1 ? 11 : 10;
      const font = c.level === 1 ? ctx.bold : ctx.regular;
      const indent = c.level === 1 ? 0 : 16;
      const num = String(c.pageIndex + 2); // +1 for 1-based, +1 for this cover
      const nw = font.widthOfTextAtSize(num, size);
      let label = ctx.safe(c.label);
      const maxLabel = WIDTH - indent - nw - 30;
      while (font.widthOfTextAtSize(label, size) > maxLabel && label.length > 4) label = label.slice(0, -2);
      if (label !== ctx.safe(c.label)) label = label.trimEnd() + '...';
      page.drawText(label, { x: MARGIN + indent, y: y - size, size, font, color: c.level === 1 ? PURPLE : INK });
      page.drawText(num, { x: MARGIN + WIDTH - nw, y: y - size, size, font, color: GREY });
      // Dotted leader between the label and the page number.
      const lx = MARGIN + indent + font.widthOfTextAtSize(label, size) + 6;
      const rx = MARGIN + WIDTH - nw - 6;
      for (let dx = lx; dx < rx; dx += 4) page.drawCircle({ x: dx, y: y - size + 2.5, size: 0.5, color: GREY });
      y -= c.level === 1 ? 19 : 15;
    }
  }

  // AI and safety notice, the same wording as the plan page on the site.
  const note =
    'This plan was written by AI from your intake answers and sent to you automatically, so no one read it before you did. ' +
    'AI can get things wrong. It is not clinical advice and does not replace your GP, your physio, or a qualified mental health professional. ' +
    'If anything looks off, unclear, or unsafe, stop and email emilyphelan@mindthegael.co.uk.';
  const lines = wrapRuns(ctx, [{ text: 'Heads up. ', bold: true, italic: false }, { text: note, bold: false, italic: false }], 9, WIDTH - 32);
  const boxH = lines.length * 13 + 24;
  const boxTop = 60 + boxH;
  page.drawRectangle({ x: MARGIN, y: 60, width: WIDTH, height: boxH, color: LILAC });
  page.drawRectangle({ x: MARGIN, y: 60, width: 4, height: boxH, color: PURPLE });
  let ny = boxTop - 12;
  for (const line of lines) {
    drawLine(ctx, line, MARGIN + 16, ny - 9, 9, INK, PURPLE);
    ny -= 13;
  }

  // Brand strip along the foot of the cover.
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: 26, color: PURPLE });
  page.drawRectangle({ x: 0, y: 26, width: A4[0], height: 3, color: LIME });
  page.drawText('mindthegael.co.uk', { x: MARGIN, y: 9, size: 8.5, font: ctx.bold, color: WHITE });
  ctx.page = saved;
}

function drawFooters(ctx: Ctx) {
  const pages = ctx.doc.getPages();
  const total = pages.length;
  pages.forEach((p, i) => {
    if (i === 0) return; // the cover has its own strip
    const t = `Page ${i + 1} of ${total}`;
    const w = ctx.regular.widthOfTextAtSize(t, 8);
    p.drawText(t, { x: MARGIN + WIDTH - w, y: 32, size: 8, font: ctx.regular, color: GREY });
    p.drawText('mindthegael.co.uk', { x: MARGIN, y: 32, size: 8, font: ctx.regular, color: GREY });
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function renderPlanPdf(opts: {
  planText: string;
  title: string;
  clientName?: string;
  date?: Date;
  /** The colour logo as PNG bytes. Optional: without it the cover uses text. */
  logoPng?: Uint8Array;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  doc.setTitle(opts.title);
  doc.setAuthor('Emily Phelan, Mind the Gael');
  doc.setCreator('Mind the Gael');

  const ctx: Ctx = {
    doc, regular, bold, italic,
    page: null as unknown as PDFPage,
    y: 0,
    title: opts.title,
    contents: [],
    section: '',
    safe: makeSafe(regular),
  };
  newPage(ctx);

  const lines = opts.planText.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) { ctx.y -= 5; continue; }

    // Tables: gather the whole block so columns can be sized together.
    if (/^\s*\|/.test(line)) {
      const block: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|[\s|:-]+\|?\s*$/.test(lines[i])) block.push(splitRow(lines[i]));
        i++;
      }
      i--;
      table(ctx, block);
      continue;
    }

    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (level === 1) sectionHeading(ctx, h[2]);
      else if (level === 2 && /week-by-week/.test(ctx.section) && /^\**\s*week\s+\d+/i.test(h[2])) weekHeading(ctx, h[2]);
      else subHeading(ctx, h[2], level);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { rule(ctx); continue; }

    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { if (q[1].trim()) blockquote(ctx, q[1]); continue; }

    const b = line.match(/^(\s*)[-*•+]\s+(.*)$/);
    if (b) { listItem(ctx, '', b[2], Math.min(2, Math.floor(b[1].replace(/\t/g, '  ').length / 2)), false); continue; }

    const n = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (n) { listItem(ctx, `${n[2]}.`, n[3], Math.min(2, Math.floor(n[1].length / 2)), true); continue; }

    // A line that is only a bold label ("**Daily practice (5-10 minutes):**")
    // introduces what follows, so it gets a little room above it.
    const runs = parseRuns(line.trim());
    if (runs.length && runs[0].bold) ctx.y -= 3;
    paragraph(ctx, runs, { after: 3 });
  }

  await drawCover(ctx, { title: opts.title, clientName: opts.clientName, date: opts.date ?? new Date(), logoPng: opts.logoPng });
  drawFooters(ctx);

  return doc.save();
}
