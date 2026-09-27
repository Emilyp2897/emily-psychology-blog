# Legal and privacy review

Checked 26 September 2026, updated 27 September after the changes below were
made. Covers `terms.astro`, `privacy.astro` and `ai-policy.astro`.

Not legal advice, and it doesn't replace the solicitor review both pages
already say they need. What it does is check the documents against what the
code actually does, which is the part a solicitor can't do without reading the
codebase.

---

## Fixed

**Terms sold a product that no longer existed.** The Terms described a monthly
subscriber blog at £5 and £8, priced the mental plan at £10 when you charge £2,
and listed a £10 physical plan. Section 4 now says everything is free except
the £2 mental plan, section 6 is a two-row price table, and the subscription
sections (6.3 and the old 7.2) are gone.

**The £10 physical plan is retired.** It was live in Stripe and in the Terms
but had no way in: the intake modal that fed it has no trigger button anywhere
on the page, so the only route to a £10 checkout was a hand-typed URL. Removed
from `create-checkout-session.ts`.

**A bad checkout link used to charge £10.** The GET route fell back to the
physical plan when the `plan` parameter was missing or misspelled, so a stale
link sent someone to a checkout for something they hadn't chosen. It returns
400 now, matching what the POST route already did.

**Supabase was missing from the privacy policy.** Section 6 listed six
processors and then said those were the only third parties who see your data,
while Supabase held account emails, hashed passwords and plan content. It's in
the table now, plus a new section 3.3 covering account data and a line in
section 7 on transfers.

**The documents said every plan was reviewed by Emily.** True when written,
false as of today. Terms section 5, privacy section 11, the AI policy table and
section 8, the dashboard notice, the plan page notice and the success page all
now say standard plans send automatically with no one reading them first, and
name the exceptions.

---

## Still open

**1. The Supabase region is a placeholder.** `privacy.astro` has
`SUPABASE_REGION = 'REGION TO BE CONFIRMED'` and it renders in the processor
table. Get the real value from Supabase dashboard, Project Settings, General,
Region. It couldn't be read from the API because Cloudflare sits in front and
returns whichever edge location is nearest the person asking. Don't guess: that
row states which country personal data lives in.

**2. The stated retention periods still aren't implemented.** Privacy section 8
promises intake submissions and plans are deleted after 24 months, and chatbot
feedback after 12. There's no deletion job anywhere. No cron, no scheduled
function, no `DELETE` against `intake_sessions` or `chat_feedback` in `src/` or
`migrations/`. Nothing has breached yet because the platform is younger than 24
months, but the clock on the earliest intakes is running. Either build the job
or reword section 8 to promise deletion on request only.

**3. Chatbot feedback stores more than the policy says.** Privacy describes it
as ratings kept anonymously. `chat-feedback.ts` actually stores the rating, the
free-text note, the full question, the full reply, the model used, and an IP
with only the last octet masked. Someone who types a name or a health detail
into the chat and then rates the reply has that text stored, and a three-octet
IP plus a timestamp isn't reliably anonymous. Reword it, or mask two octets and
drop the "anonymous" claim.

**4. `openai` is installed and `OPENAI_API_KEY` is live in Vercel, but OpenAI
is never called** anywhere in `src/`. The privacy policy is right to list
Anthropic only. Remove the package and revoke the key. An unused credential is
one nobody is watching.

**5. Both pages still carry the "Draft, pending solicitor review before paid
launch" notice.** The paid product is live, so that notice is describing a
deadline that has passed rather than one coming up.

**6. Workshops.** You said everything except the £2 plan is free, so the Terms
now say the workshops are free. The workshops page still says £30 in four
places. One of the two needs to change and I didn't want to guess which.

---

## Order I'd do them in

1. Supabase region. One line, and it's the one a regulator checks first.
2. Workshops: £30 or free. The Terms and the page currently disagree.
3. Retention: build the job or reword the promise.
4. Chatbot feedback wording.
5. Drop the draft notices.
6. Remove `openai` and revoke the key.
