/**
 * Renders a generated plan into a branded PDF for the customer's email.
 *
 * Built with pdf-lib rather than a headless browser. Chromium on a
 * serverless function is slow to cold-start and large, and plan generation
 * already runs for minutes against the function timeout; adding a browser to
 * that path is how you turn a slow request into a failed one. pdf-lib is
 * pure JavaScript and draws in milliseconds.
 *
 * The model returns markdown-ish text, so this handles the subset it
 * actually emits: headings, bullets, numbered lists, bold runs, tables as
 * plain rows, and paragraphs. Anything unrecognised is drawn as body text
 * rather than dropped, so a customer never receives a PDF with content
 * silently missing.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// Brand colours, matching the site.
const PURPLE = rgb(0x69 / 255, 0x00 / 255, 0x5a / 255);
const GREEN_DARK = rgb(0x03 / 255, 0x0a / 255, 0x06 / 255);
const LIME_DEEP = rgb(0x5c / 255, 0x7a / 255, 0x1f / 255);
const GREY = rgb(0.35, 0.35, 0.35);
const RULE = rgb(0.85, 0.85, 0.85);

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 54;
const WIDTH = A4[0] - MARGIN * 2;

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  pageNo: number;
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage(A4);
  ctx.pageNo += 1;
  ctx.y = A4[1] - MARGIN;
  // Running footer, so a printed plan still says where it came from.
  ctx.page.drawText(`Mind the Gael  ·  page ${ctx.pageNo}`, {
    x: MARGIN,
    y: 28,
    size: 8,
    font: ctx.regular,
    color: GREY,
  });
}

function room(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 24) newPage(ctx);
}

/** Greedy wrap. pdf-lib has no layout engine, so lines are measured by hand. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // A single word longer than the line still has to go somewhere.
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      } else line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function draw(
  ctx: Ctx,
  text: string,
  opts: { size?: number; font?: PDFFont; color?: any; indent?: number; gap?: number } = {},
) {
  const size = opts.size ?? 10.5;
  const font = opts.font ?? ctx.regular;
  const indent = opts.indent ?? 0;
  const leading = size * 1.42;
  for (const line of wrap(text, font, size, WIDTH - indent)) {
    room(ctx, leading);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y - size,
      size,
      font,
      color: opts.color ?? GREEN_DARK,
    });
    ctx.y -= leading;
  }
  ctx.y -= opts.gap ?? 0;
}

/** Strips markdown emphasis. Bold runs are not worth a second font pass here. */
function clean(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(?!\s)(.+?)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

export async function renderPlanPdf(opts: {
  planText: string;
  title: string;
  clientName?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: Ctx = { doc, page: null as unknown as PDFPage, y: 0, regular, bold, pageNo: 0 };
  newPage(ctx);

  doc.setTitle(opts.title);
  doc.setAuthor('Emily Phelan, Mind the Gael');
  doc.setCreator('Mind the Gael');

  // Cover block.
  draw(ctx, 'MIND THE GAEL', { size: 9, font: bold, color: LIME_DEEP });
  ctx.y -= 4;
  draw(ctx, opts.title, { size: 22, font: bold, color: PURPLE, gap: 2 });
  if (opts.clientName) draw(ctx, `Prepared for ${opts.clientName}`, { size: 11, color: GREY });
  ctx.y -= 6;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + WIDTH, y: ctx.y },
    thickness: 1,
    color: PURPLE,
  });
  ctx.y -= 18;

  for (const raw of opts.planText.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      ctx.y -= 6;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 17 : level === 2 ? 14 : 12;
      ctx.y -= level <= 2 ? 10 : 6;
      room(ctx, size * 2);
      draw(ctx, clean(h[2]), { size, font: bold, color: PURPLE, gap: 3 });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const body = clean(line.replace(/^\s*[-*•]\s+/, ''));
      room(ctx, 15);
      ctx.page.drawText('•', { x: MARGIN + 4, y: ctx.y - 10.5, size: 10.5, font: regular, color: LIME_DEEP });
      draw(ctx, body, { indent: 18 });
      continue;
    }
    const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (num) {
      room(ctx, 15);
      ctx.page.drawText(`${num[1]}.`, { x: MARGIN + 2, y: ctx.y - 10.5, size: 10.5, font: bold, color: LIME_DEEP });
      draw(ctx, clean(num[2]), { indent: 22 });
      continue;
    }
    // Markdown table rows: drawn as plain lines rather than dropped.
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue; // separator row
      const cells = line.split('|').map((c) => clean(c)).filter((c) => c !== '');
      if (cells.length) draw(ctx, cells.join('   ·   '), { size: 10, indent: 6 });
      continue;
    }
    draw(ctx, clean(line), { gap: 2 });
  }

  // Safety footer, same wording as the email.
  ctx.y -= 10;
  room(ctx, 46);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + WIDTH, y: ctx.y },
    thickness: 0.5,
    color: RULE,
  });
  ctx.y -= 14;
  draw(ctx, 'This is not clinical advice and it does not replace your GP, your physio, or a qualified mental health professional. If something here looks wrong for you or feels unsafe, stop and email emilyphelan@mindthegael.co.uk.', {
    size: 8.5,
    color: GREY,
  });

  return doc.save();
}
