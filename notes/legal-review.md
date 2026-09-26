# Legal and privacy review

Reviewed 26 September 2026 against the code as it stands. Covers
`src/pages/terms.astro`, `src/pages/privacy.astro` and `src/pages/ai-policy.astro`.

This is not legal advice and it does not replace the solicitor review the
privacy policy's own draft notice already calls for. What it does is check the
documents against what the platform actually does, which is the part a
solicitor cannot do without reading the codebase.

Findings are ordered by how much they matter before a release.

---

## 1. The Terms describe a product that no longer exists, at prices you do not charge

**Severity: high. Fix before release.**

`terms.astro` is a contract, and it currently sells a subscription that was
retired in July and quotes four prices that are all wrong.

| Terms says | Reality |
|---|---|
| S4: "Subscriber blog: a monthly paid subscription giving access to specific articles and resources" | The paywall was removed on 27 July 2026. All content is free. |
| S6.1: Subscriber blog, founding offer, £5 / month | Product does not exist |
| S6.1: Subscriber blog, standard, £8 / month | Product does not exist |
| S6.1: 6-Week Mental Performance Plan, £10 one-off | Charged at **£2** (`create-checkout-session.ts:25`), and `/pricing` says £2 |
| S6.1: 6-Week Physical Training Plan, £10 one-off | £10 is correct (`create-checkout-session.ts:18`), but it is not listed on `/pricing` |
| S6.3: "Subscription terms", 14-day free trial, monthly billing | No subscription exists. Both live Stripe plans are `mode: "payment"` |
| S7.2: "Subscriber blog refunds", pro-rating, trial rules | Governs a product that does not exist |
| Nothing | **Workshops at £30 are sold and are not in the Terms at all** |

The mental plan mismatch is the sharp one. The homepage and `/pricing` both
say £2, the Terms say £10. A customer can point at either document.

**What needs deciding, not just editing:** whether the £10 physical plan is
still on sale. It is live in Stripe and in the Terms, but absent from
`/pricing`. If it is still sold it needs a price on the pricing page; if it is
not, the Stripe entry should go.

## 2. Supabase is missing from the privacy policy's processor list

**Severity: high. Fix before release.**

Privacy S6 lists Anthropic, Stripe, Vercel, Vercel Postgres (Neon), Resend and
Google, and then states: *"The processors above are the only third parties who
see it."*

Supabase is not on that list, and it holds:

- account records for everyone who signs up (`login.astro`, `signup.astro`)
- generated plans saved against those accounts (`programme-finalize.ts`)
- the data behind the customer dashboard and plan pages

That makes the "only third parties" sentence inaccurate, and it means a
processor holding names, emails and plan content is undisclosed. Supabase
needs a row in the S6 table and a line in S7 (international transfers) naming
the region its project is hosted in.

## 3. The stated retention periods are not implemented anywhere

**Severity: medium-high.**

Privacy S8 promises specific deletion:

- intake submissions and generated plans: "Up to 24 months from submission,
  then deleted"
- chatbot feedback: "kept anonymously for up to 12 months"

There is no deletion mechanism in the repo. No cron job, no scheduled
function, no cleanup script, and no `DELETE` statement against
`intake_sessions` or `chat_feedback` anywhere in `src/` or `migrations/`.

Nothing has breached yet, because the platform is younger than 24 months. But
the policy states a retention schedule the system cannot honour, and the
24-month clock on the earliest intakes is already running. Either build the
deletion job or reword S8 to describe deletion on request only.

## 4. Chatbot feedback stores more than the policy describes

**Severity: medium.**

Privacy S3.3 and S8 describe chatbot handling as message text not stored, and
"individual feedback ratings kept anonymously".

`chat-feedback.ts:103` actually stores, per feedback submission: the rating,
the user's free-text note, **the full question text**, **the full reply text**,
the model used, and a partially masked IP (`maskClient` strips only the final
octet, so `ip:81.2.69.142` becomes `81.2.69.x`).

Two gaps:

- "ratings" understates it. A user who types a name, a club or a health detail
  into the chat and then rates the reply has that text stored.
- A three-octet IP plus a timestamp is not reliably anonymous. It is
  pseudonymous at best, so calling it anonymous is a stronger claim than the
  implementation supports.

The honest fix is wording: say that submitting feedback stores the exchange it
relates to. Alternatively mask two octets and drop the claim.

## 5. The GET checkout route silently falls back to a £10 charge

**Severity: medium.**

`create-checkout-session.ts:79`:

```js
const plan = VALID_PLANS.includes(rawPlan) ? rawPlan : "programme-6-week";
```

A GET request with a missing, misspelled or stale `plan` parameter does not
error. It quietly creates a **£10 physical plan** checkout. The POST handler
at line 124 gets this right and returns 400.

So a broken or outdated link sends someone to a £10 checkout for a product
they did not choose. They would see the amount on Stripe's page before paying,
which limits the damage, but a wrong price is the wrong thing to fail towards.
The GET handler should return 400 the way POST does.

## 6. Smaller wording points

- **Privacy S11** says "during the platform's early phase every plan is
  reviewed by Emily before it is sent to you." I checked this and it is
  **accurate**: `programme-finalize.ts:225` sets `reviewRequired: true` and
  `sentFullPlanToClient: false`, and the customer gets a holding email. Worth
  noting because it is the kind of claim that silently becomes false the day
  autonomous sending is switched on. Tie it to a date or a version.
- **`openai` is a dependency and `OPENAI_API_KEY` is set in Vercel
  production, but OpenAI is never called** anywhere in `src/`. The privacy
  policy is right to list Anthropic only. The unused package and the live
  unused API key should both go, on the general principle that a credential
  nobody uses is a credential nobody is watching.
- **Privacy last revised 11 June 2026**, and it still carries the "Draft,
  pending review by a qualified solicitor before paid launch" notice. Paid
  products are live now (mental plans, workshops), so that notice is overdue
  rather than pending.
- **Footer disclaimer and Terms S3** both open with "Nothing on the platform
  is..." / "Nothing shared here is...". That is the sentence shape you asked
  to remove elsewhere. I have deliberately **not** changed these two, because
  rewording a liability disclaimer is a legal decision rather than a voice
  one. Flagging so it is your call.

---

## Suggested order

1. Terms pricing and the subscription sections (S4, S6, S7.2), plus add
   workshops. Highest risk, purely editorial once you decide on the physical
   plan.
2. Add Supabase to the privacy processor table and transfers section.
3. Fix the GET checkout fallback. One line.
4. Decide retention: build the deletion job, or reword S8.
5. Reword the chatbot feedback description in S3.3 and S8.
6. Remove the `openai` dependency and revoke the unused key.
