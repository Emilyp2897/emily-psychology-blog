// Helpers that convert the model's markdown-style plan output into clean
// HTML for email bodies. Email clients are inconsistent with CSS support,
// so every style is INLINE and conservative (no flexbox, no custom fonts,
// no remote stylesheets).

const BRAND_GREEN_DARK = '#0a1a0e';
const BRAND_GREEN_LIME = '#c0fe71';
const BRAND_PURPLE = '#69005a';
const TEXT_DARK = '#1a1a1a';
const TEXT_MUTED = '#555555';
const BORDER_SOFT = '#e0e0e0';

// The site origin for absolute URLs. PUBLIC_SITE during local dev is
// localhost (correct for Stripe success_url), but email images need a
// publicly reachable URL because the email recipient's mail client
// fetches them from the internet, not from your laptop. So the logo URL
// always points to production.
const SITE_ORIGIN =
  (import.meta.env.PUBLIC_SITE as string | undefined) || 'https://mindthegael.co.uk';

const PRODUCTION_ORIGIN = 'https://mindthegael.co.uk';
const LOGO_URL = `${PRODUCTION_ORIGIN}/assets/MTG_colour.png`;
const SAOIRSE_URL = `${PRODUCTION_ORIGIN}/assets/saoirse.png`;

// Reusable signature block shown at the bottom of client-facing emails.
// Edit this string to change the signature across every email at once.
function buildSignatureHtml(): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top: 28px; padding-top: 16px; border-top: 1px solid ${BORDER_SOFT}; width: 100%;">`,
    `<tr>`,
    `<td style="vertical-align: top; padding-right: 14px; width: 64px;">`,
    `<img src="${SAOIRSE_URL}" alt="Saoirse" width="56" style="display: block; width: 56px; height: auto; border: 0;" />`,
    `</td>`,
    `<td style="vertical-align: top;">`,
    `<p style="margin: 0 0 4px; font-size: 15px; font-weight: 700; color: ${TEXT_DARK};">Emily Phelan</p>`,
    `<p style="margin: 0 0 4px; font-size: 13px; color: ${TEXT_MUTED};">Founder, Mind the Gael</p>`,
    `<p style="margin: 0 0 2px; font-size: 13px;"><a href="mailto:emilyphelan@mindthegael.co.uk" style="color: ${BRAND_PURPLE}; text-decoration: none; font-weight: 600;">emilyphelan@mindthegael.co.uk</a></p>`,
    `<p style="margin: 0 0 2px; font-size: 13px;"><a href="https://instagram.com/mind_the_gael" style="color: ${BRAND_PURPLE}; text-decoration: none; font-weight: 600;">@mind_the_gael</a></p>`,
    `<p style="margin: 8px 0 0; font-size: 12px; color: ${TEXT_MUTED};"><a href="${SITE_ORIGIN}" style="color: ${TEXT_MUTED}; text-decoration: underline;">mindthegael.co.uk</a></p>`,
    `</td>`,
    `</tr>`,
    `</table>`,
  ].join('\n');
}

// Reusable plain-text signature for the text/plain email fallback.
export function buildSignatureText(): string {
  return [
    'Emily Phelan',
    'Founder, Mind the Gael',
    'emilyphelan@mindthegael.co.uk',
    'Instagram: @mind_the_gael',
    'mindthegael.co.uk',
  ].join('\n');
}

// Replace em-dashes and en-dashes in model output with safer punctuation.
// Reason: em-dashes are an AI tell and not in Emily's voice. The system
// prompt asks the model to avoid them, but models occasionally emit them
// anyway. This is the safety net that catches any that slip through.
//
// Strategy:
// - Dash surrounded by spaces (most common in prose) becomes a comma.
// - Bare dash becomes a comma too.
// - Hyphens (-) in compound modifiers like "6-week", "32-year-old" are
//   STANDARD English and stay untouched.
export function stripDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s+,/g, ',');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape, then apply inline markdown: **bold** and *italic*. Bold runs
// first so it doesn't get eaten by the italic regex.
function inlineMd(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

// Render a block of markdown table lines (the first line is headers,
// the second is the |---|---| separator, the rest are body rows).
function renderMarkdownTable(lines: string[]): string {
  const parseRow = (line: string): string[] =>
    line.replace(/^\s*\||\|\s*$/g, '').split('|').map((s) => s.trim());

  const isSeparator = (line: string) => /^[\s|:-]+$/.test(line) && line.includes('-');

  if (lines.length < 2) return '';
  const headerCells = parseRow(lines[0]);

  let bodyStart = 1;
  if (isSeparator(lines[1])) bodyStart = 2;
  const bodyRows = lines.slice(bodyStart).map(parseRow);

  const thStyle = `text-align: left; padding: 10px 12px; background: ${BRAND_GREEN_DARK}; color: ${BRAND_GREEN_LIME}; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid ${BRAND_GREEN_DARK};`;
  const tdStyle = `padding: 9px 12px; border: 1px solid ${BORDER_SOFT}; font-size: 14px; vertical-align: top; color: ${TEXT_DARK};`;

  const headerHtml = headerCells
    .map((cell) => `<th style="${thStyle}">${inlineMd(cell)}</th>`)
    .join('');

  const bodyHtml = bodyRows
    .map(
      (row) =>
        '<tr>' +
        row.map((cell) => `<td style="${tdStyle}">${inlineMd(cell)}</td>`).join('') +
        '</tr>'
    )
    .join('\n');

  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin: 10px 0 18px; border-collapse: collapse;">`,
    `<thead><tr>${headerHtml}</tr></thead>`,
    `<tbody>${bodyHtml}</tbody>`,
    `</table>`,
  ].join('\n');
}

// Convert the model's plain output (with `#`, `##` headers, `- ` bullets,
// `**bold**`, blank-line paragraphs, and `| col | col |` tables) into a
// stream of HTML blocks.
function planTextToHtmlBody(plainText: string): string {
  const lines = plainText.split('\n');
  const out: string[] = [];
  let inList = false;
  let i = 0;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();

    // Markdown table: collect all consecutive |-prefixed lines.
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      closeList();
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith('|') &&
        lines[i].trim().endsWith('|')
      ) {
        tableLines.push(lines[i].trim());
        i++;
      }
      out.push(renderMarkdownTable(tableLines));
      continue;
    }

    if (trimmed.startsWith('### ')) {
      closeList();
      out.push(
        `<h4 style="margin: 22px 0 6px; color: ${BRAND_GREEN_DARK}; font-size: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;">${inlineMd(trimmed.slice(4))}</h4>`
      );
    } else if (trimmed.startsWith('## ')) {
      closeList();
      out.push(
        `<h3 style="margin: 20px 0 6px; color: ${BRAND_PURPLE}; font-size: 15px; font-weight: 700;">${inlineMd(trimmed.slice(3))}</h3>`
      );
    } else if (trimmed.startsWith('# ')) {
      closeList();
      out.push(
        `<h2 style="margin: 32px 0 8px; padding-bottom: 6px; border-bottom: 2px solid ${BRAND_GREEN_LIME}; color: ${BRAND_PURPLE}; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;">${inlineMd(trimmed.slice(2))}</h2>`
      );
    } else if (trimmed.startsWith('> ') || trimmed === '>') {
      // Markdown blockquote: collect consecutive `>` lines and render as
      // a highlighted callout box. Used for exercise descriptions.
      closeList();
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith('> ') || lines[i].trim() === '>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const inner = quoteLines
        .map((q) =>
          q === ''
            ? '<br/>'
            : `<p style="margin: 0 0 6px; line-height: 1.55; font-size: 14px; color: ${BRAND_PURPLE};">${inlineMd(q)}</p>`
        )
        .join('');
      out.push(
        `<div style="margin: 8px 0 18px; padding: 12px 14px; background: #f6e8f3; border-left: 4px solid ${BRAND_PURPLE}; border-radius: 6px;">${inner}</div>`
      );
      continue;
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || /^\*\s/.test(trimmed)) {
      if (!inList) {
        out.push(`<ul style="margin: 6px 0 10px; padding-left: 20px; color: ${TEXT_DARK};">`);
        inList = true;
      }
      const itemText = trimmed.replace(/^[-•*]\s+/, '');
      out.push(`<li style="margin-bottom: 4px; line-height: 1.55;">${inlineMd(itemText)}</li>`);
    } else if (trimmed === '') {
      closeList();
    } else if (/^[A-Z][A-Z\s/&,()-]+:?\s*$/.test(trimmed) && trimmed.length < 60) {
      closeList();
      out.push(
        `<p style="margin: 12px 0 4px; color: ${BRAND_PURPLE}; font-size: 13px; font-weight: 700; letter-spacing: 0.04em;">${inlineMd(trimmed)}</p>`
      );
    } else {
      closeList();
      out.push(
        `<p style="margin: 6px 0 10px; color: ${TEXT_DARK}; line-height: 1.6; font-size: 15px;">${inlineMd(line)}</p>`
      );
    }
    i++;
  }
  closeList();
  return out.join('\n');
}

function emailShell(opts: { title: string; bodyHtml: string; footerHtml?: string }): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeHtml(opts.title)}</title>`,
    '</head>',
    `<body style="margin: 0; padding: 0; background: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #f4f4f4; padding: 24px 0;">`,
    '<tr><td align="center">',
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width: 640px; width: 100%; background: #ffffff; border: 1px solid ${BORDER_SOFT}; border-radius: 12px; overflow: hidden;">`,
    // Branded header with logo
    `<tr><td style="background: ${BRAND_GREEN_DARK}; padding: 24px 28px;">`,
    `<img src="${LOGO_URL}" alt="Mind the Gael" width="180" style="display: block; max-width: 180px; height: auto; margin-bottom: 14px; border: 0;" />`,
    `<div style="color: #ffffff; font-size: 22px; font-weight: 700;">${escapeHtml(opts.title)}</div>`,
    '</td></tr>',
    // Body
    `<tr><td style="padding: 24px 28px; color: ${TEXT_DARK}; font-size: 15px; line-height: 1.6;">`,
    opts.bodyHtml,
    '</td></tr>',
    // Footer
    `<tr><td style="background: #fafafa; padding: 18px 28px; border-top: 1px solid ${BORDER_SOFT}; color: ${TEXT_MUTED}; font-size: 12px; line-height: 1.5;">`,
    opts.footerHtml ||
      'This email is from Mind the Gael, an educational platform for female athletes. It is not medical advice. If anything in your plan feels off, painful, or unclear, stop and email Emily at <a href="mailto:emilyphelan@mindthegael.co.uk" style="color: ' +
        BRAND_PURPLE +
        '; font-weight: 700;">emilyphelan@mindthegael.co.uk</a>.',
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body></html>',
  ].join('\n');
}

// Convert a generated plan (markdown-style text) into a styled HTML email
// for the client. Includes a greeting, the plan, the calendar link, and
// the standard footer disclaimer.
export function buildClientPlanEmailHtml(opts: {
  firstName: string;
  duration: string;
  sportProfileName: string;
  planText: string;
  calendarUrl: string;
  emilyEmail: string;
}): string {
  const greeting = `<p style="margin: 0 0 14px; font-size: 16px;">Hi ${escapeHtml(opts.firstName)},</p>`;

  const intro =
    `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6;">Thanks for buying the ${escapeHtml(opts.duration)} programme. Below is your full plan, built around your sport (${escapeHtml(opts.sportProfileName)}), your equipment, and your goals.</p>`;

  const safety = [
    `<div style="margin: 16px 0 24px; padding: 14px 16px; background: #fff8e1; border-left: 4px solid #f6c84a; color: ${TEXT_DARK}; font-size: 14px; line-height: 1.55;">`,
    `<p style="margin: 0 0 6px; font-weight: 700;">A few important notes before you start:</p>`,
    `<ul style="margin: 0; padding-left: 18px;">`,
    `<li style="margin-bottom: 4px;">This plan is educational guidance, not clinical or medical advice.</li>`,
    `<li style="margin-bottom: 4px;">If anything feels off, painful, or unclear, stop and email me at <a href="mailto:${escapeHtml(opts.emilyEmail)}" style="color: ${BRAND_PURPLE}; font-weight: 700;">${escapeHtml(opts.emilyEmail)}</a>.</li>`,
    `<li>If you experience new pain or a change in how your body is responding, contact your doctor or physio.</li>`,
    `</ul>`,
    `</div>`,
  ].join('\n');

  const planBlock = planTextToHtmlBody(opts.planText);

  const calendarBlock = [
    `<hr style="border: 0; border-top: 1px solid ${BORDER_SOFT}; margin: 28px 0;" />`,
    `<p style="margin: 0 0 12px; font-size: 15px; line-height: 1.6;">Once you've had a read through, if you want to talk it through, book a 1:1 chat with me here:</p>`,
    `<p style="margin: 0 0 20px;"><a href="${escapeHtml(opts.calendarUrl)}" style="display: inline-block; padding: 10px 18px; background: ${BRAND_GREEN_LIME}; color: ${BRAND_GREEN_DARK}; text-decoration: none; border-radius: 8px; font-weight: 700;">Book a chat with Emily</a></p>`,
    `<p style="margin: 0; font-size: 14px; color: ${TEXT_MUTED};">Or reach me any time at <a href="mailto:${escapeHtml(opts.emilyEmail)}" style="color: ${BRAND_PURPLE}; font-weight: 700;">${escapeHtml(opts.emilyEmail)}</a>. I want to know how you get on.</p>`,
  ].join('\n');

  // Report mechanism: lets the client flag anything that felt unclear,
  // unsafe, or off. Required for AI transparency (Priority 3 of the legal
  // checklist). Routes to the existing content-feedback form with a
  // source flag so Emily can spot plan-email reports separately.
  const reportBlock = [
    `<hr style="border: 0; border-top: 1px solid ${BORDER_SOFT}; margin: 28px 0 14px;" />`,
    `<p style="margin: 0; font-size: 13px; color: ${TEXT_MUTED}; line-height: 1.55;">`,
    `Was anything in this plan unclear, unsafe, or off? Plans are AI-generated and can contain errors.`,
    `<a href="https://mindthegael.co.uk/content-feedback?source=plan_email" style="color: ${BRAND_PURPLE}; font-weight: 700;">Report it here</a>`,
    `and Emily will look at it within 48 hours.`,
    `</p>`,
  ].join(' ');

  const body = greeting + intro + safety + planBlock + calendarBlock + reportBlock + buildSignatureHtml();
  return emailShell({ title: `Your ${opts.duration} plan`, bodyHtml: body });
}

// Convert the notification email Emily receives into styled HTML. Shows a
// clear metadata block at the top, then the plan content below.
export function buildEmilyNotificationEmailHtml(opts: {
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  sport: string;
  sportProfileName: string;
  track: string;
  planDuration: string;
  stripeSessionId: string;
  intakeToken: string;
  planText: string;
}): string {
  const metaRow = (label: string, value: string) =>
    `<tr><td style="padding: 4px 10px 4px 0; color: ${TEXT_MUTED}; font-size: 13px; vertical-align: top;">${escapeHtml(label)}</td><td style="padding: 4px 0; color: ${TEXT_DARK}; font-size: 14px; font-weight: 600;">${escapeHtml(value)}</td></tr>`;

  const metaTable = [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin-bottom: 16px;">`,
    metaRow('Submitted', new Date().toISOString()),
    metaRow('Name', opts.clientName),
    metaRow('Email', opts.clientEmail),
    metaRow('Phone', opts.clientPhone || 'Not provided'),
    metaRow('Sport', `${opts.sport} (matched profile: ${opts.sportProfileName})`),
    metaRow('Track', opts.track),
    metaRow('Plan duration', opts.planDuration),
    metaRow('Stripe session', opts.stripeSessionId),
    metaRow('Intake token', opts.intakeToken),
    `</table>`,
  ].join('\n');

  const intro = `<p style="margin: 0 0 14px; font-size: 15px;">A new programme purchase has been finalised. The plan below has been emailed to the client.</p>`;

  const planBlock = [
    `<hr style="border: 0; border-top: 1px solid ${BORDER_SOFT}; margin: 24px 0;" />`,
    `<p style="margin: 0 0 12px; color: ${BRAND_PURPLE}; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">Plan sent to client</p>`,
    planTextToHtmlBody(opts.planText),
  ].join('\n');

  const body = intro + metaTable + planBlock;
  return emailShell({
    title: `New purchase: ${opts.clientName}`,
    bodyHtml: body,
    footerHtml:
      'Notification copy. The client has already received the same plan. Cross-check Stripe by session ID above before any follow-up.',
  });
}
