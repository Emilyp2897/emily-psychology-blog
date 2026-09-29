import { emailShell, emailButton } from './src/lib/email-format.ts';
import fs from 'node:fs';
const body = `
      <p>Hi Emily,</p>
      <p>Your 6-week mental performance plan is ready. It is in your dashboard now, and attached to this email as a PDF you can print.</p>
      ${emailButton('https://mindthegael.co.uk/dashboard', 'Open your plan')}
      <div style="margin: 8px 0 18px; padding: 12px 14px; background: #f6e8f3; border-left: 4px solid #69005a; border-radius: 6px;">
        <p style="margin:0;">This plan was written by AI and released without review. If something looks wrong for you, stop and email me.</p>
      </div>
      <p style="font-size: 0.9em; color: #444;">This is not clinical advice and it does not replace your GP, your physio, or a qualified mental health professional.</p>
`;
fs.writeFileSync('/tmp/email-preview.html', emailShell({ title: 'Your plan is ready', bodyHtml: body }));
console.log('written');
