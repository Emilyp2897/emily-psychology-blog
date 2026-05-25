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

// The site origin is needed to build absolute URLs for images embedded in
// email HTML (relative URLs don't work in email clients). Falls back to
// the production URL if PUBLIC_SITE isn't set.
const SITE_ORIGIN =
  (import.meta.env.PUBLIC_SITE as string | undefined) || 'https://mindthegael.co.uk';

const LOGO_URL = `${SITE_ORIGIN}/assets/MindtheGaelLogowithCaption.png`;

// Reusable signature block shown at the bottom of client-facing emails.
// Edit this string to change the signature across every email at once.
function buildSignatureHtml(): string {
  return [
    `<div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid ${BORDER_SOFT};">`,
    `<p style="margin: 0 0 4px; font-size: 15px; font-weight: 700; color: ${TEXT_DARK};">Emily Phelan</p>`,
    `<p style="margin: 0 0 4px; font-size: 13px; color: ${TEXT_MUTED};">Founder, Mind the Gael</p>`,
    `<p style="margin: 0 0 2px; font-size: 13px;"><a href="mailto:emilyphelan@mindthegael.co.uk" style="color: ${BRAND_PURPLE}; text-decoration: none; font-weight: 600;">emilyphelan@mindthegael.co.uk</a></p>`,
    `<p style="margin: 0 0 2px; font-size: 13px;"><a href="https://instagram.com/mind_the_gael" style="color: ${BRAND_PURPLE}; text-decoration: none; font-weight: 600;">@mind_the_gael</a></p>`,
    `<p style="margin: 8px 0 0; font-size: 12px; color: ${TEXT_MUTED};"><a href="${SITE_ORIGIN}" style="color: ${TEXT_MUTED}; text-decoration: underline;">mindthegael.co.uk</a></p>`,
    `</div>`,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert the model's plain output (with `#`, `##` headers, `- ` bullets,
// blank-line paragraphs) into a stream of HTML blocks.
function planTextToHtmlBody(plainText: string): string {
  const lines = plainText.split('\n');
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (trimmed.startsWith('# ')) {
      closeList();
      out.push(
        `<h2 style="margin: 32px 0 8px; padding-bottom: 6px; border-bottom: 2px solid ${BRAND_GREEN_LIME}; color: ${BRAND_PURPLE}; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase;">${escapeHtml(trimmed.slice(2))}</h2>`
      );
    } else if (trimmed.startsWith('## ')) {
      closeList();
      out.push(
        `<h3 style="margin: 20px 0 6px; color: ${BRAND_PURPLE}; font-size: 15px; font-weight: 700;">${escapeHtml(trimmed.slice(3))}</h3>`
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || /^\*\s/.test(trimmed)) {
      if (!inList) {
        out.push(`<ul style="margin: 6px 0 10px; padding-left: 20px; color: ${TEXT_DARK};">`);
        inList = true;
      }
      const itemText = trimmed.replace(/^[-•*]\s+/, '');
      out.push(`<li style="margin-bottom: 4px; line-height: 1.55;">${escapeHtml(itemText)}</li>`);
    } else if (trimmed === '') {
      closeList();
      // Blank line: skip; the next paragraph will get its own margin.
    } else if (/^[A-Z][A-Z\s/&,()-]+:?\s*$/.test(trimmed) && trimmed.length < 60) {
      // A short ALL-CAPS line treated as a sub-label (e.g. "AVOID:", "PREFER:").
      closeList();
      out.push(
        `<p style="margin: 12px 0 4px; color: ${BRAND_PURPLE}; font-size: 13px; font-weight: 700; letter-spacing: 0.04em;">${escapeHtml(trimmed)}</p>`
      );
    } else {
      closeList();
      out.push(
        `<p style="margin: 6px 0 10px; color: ${TEXT_DARK}; line-height: 1.6; font-size: 15px;">${escapeHtml(line)}</p>`
      );
    }
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

  const body = greeting + intro + safety + planBlock + calendarBlock + buildSignatureHtml();
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
