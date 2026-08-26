# SMS missed-sit reminders — cost investigation

**Issue:** #672
**Status:** Investigation complete. No production behavior changes in this PR.
**Date researched:** 2026-08-26 (every price below was checked on this date)
**Related:** #599 (missed-sit voice call), #345 / #346 (notification foundation), `docs/notifications.md`

This document reopens the "Email/SMS channels" line that
`docs/issues/unified-notifications-settings.md` explicitly listed as out of scope
("Out of scope for this ticket … Email/SMS channels"). The question then was
sequencing; the question now is cost.

## Problem

Still Point nudges at two intensities, with a gap between them. (Three channels
ship — APNs push, web push, and the call — but the two push channels are the
same intervention delivered to different devices.)

A **push notification** is free to send and easy to ignore. Airship's analysis of
~50 billion notifications puts direct iOS reaction rates around 4.9%; push open
rates are low by design, since users can act without formally opening, but the
signal is still weak.

A **phone call** (#599, shipped) is the opposite: near-impossible to ignore, and
a large intervention for "you haven't sat today."

A plain text sits between them. The open question this document answers is what
that middle option costs, all-in, at our scale — and whether it is worth a
recurring bill when push already costs nothing per send.

## What already exists (verified against code, 2026-08-26)

Every claim in the integration sketch below was checked against the current
`main`. Findings that contradict the issue's framing are flagged.

| Piece | Where | State |
|---|---|---|
| Cron entry point | `src/app/api/cron/dispatch-notifications/route.ts` | Auth via `CRON_SECRET`, delegates to `dispatchDueNotifications()` |
| Cron cadence | `vercel.json` | **Every 5 minutes** (`*/5 * * * *`), not hourly — the *call slots* are hourly, the cron is not |
| Scheduler | `src/lib/notification-scheduler.ts` | Two independent passes: a push pass and a separate call pass |
| Per-user send time | `notificationPreferences.dailyReminderTime` + `.tz` | Exists; a "6pm text" is configuration, not new work |
| Quiet hours | `isInQuietHours()`, `evaluateReminderDispatchWindow()` | Exists — but see the finding below |
| Idempotent ledger | `notification_dispatches`, unique on `(userId, notificationType, windowKey)` | Exists; `claimNotificationDispatch()` uses `onConflictDoNothing()` |
| E.164 phone | `notificationPreferences.callPhoneNumber` (varchar 20) | Exists; validated by `isValidE164PhoneNumber()` |
| Consent timestamp | `notificationPreferences.callConsentAt` | Exists — but see the compliance finding below |
| Attempt log | `call_attempts` table, `logCallAttempt()` in `src/lib/vapi.ts` | Exists; good template for an SMS attempt log |
| Inbound webhook route | — | **Does not exist.** `src/app/api/` has no webhook handler of any kind |

### Three findings that change the sketch

**1. The push pass is gated on `pushEnabled`.** `dispatchDueNotifications()`
selects candidates with `eq(notificationPreferences.pushEnabled, true)` before
any per-type branching. A user who wants texts but not pushes would never be
scanned. This rules out "add SMS as a third task inside
`sendDailyReminderNotification`" as a complete design.

**2. `fanOutChannels()` delivers to every channel unconditionally.** It runs all
tasks via `Promise.allSettled` and returns `delivered = results.some(...)`.
Adding an SMS task there sends push *and* SMS to everyone on the daily reminder,
with no opt-in gate — precisely the "getting both is worse than either" outcome
the issue warns about. It would also mark the ledger claim satisfied when only
the SMS succeeded, masking a broken push.

**3. Quiet hours do not apply to the call pass.** `evaluateMissedSitCallDue()`
takes `(localMinutes, windowStart, windowStop)` and never consults
`quietHoursStart` / `quietHoursEnd`. The call pass bounds itself with the
explicit `callWindowStart` / `callWindowStop` instead. So the claim that
"quiet-hours math is channel-agnostic" is only true of the *push* pass. If SMS
copies the call pass, quiet hours must be wired in deliberately — it is not
inherited.

## Scope and cost-model assumptions

Stated up front so the numbers below are reproducible.

- **US only.** International adds a large multiplier (per-destination rates
  commonly run 2–10x US, and some destinations require separate sender
  registration). Out of scope; noted as a real cost cliff if the user base is
  not US-concentrated.
- **One segment per reminder.** GSM-7 encoding gives 160 characters in a single
  segment. "You haven't sat yet today" fits comfortably. An emoji forces UCS-2
  encoding, which drops the single-segment limit to 70 characters (67 per
  segment once a message spans several). A short reminder therefore stays one
  segment even with an emoji — but the headroom shrinks from 160 to 70, so a
  slightly longer emoji-bearing message crosses into a second segment and
  doubles the per-send cost. Worth knowing before someone lengthens the copy.
- **One message per user per day, 30 days per month.** So 50 / 500 / 5,000
  daily reminders = 1,500 / 15,000 / 150,000 segments per month.
- **Carrier pass-through fees are included** in every all-in figure. They are
  charged on top of the provider's base rate by all US providers and are the
  single most commonly omitted line in provider marketing.
- **One 10DLC campaign, one phone number.**

## Provider comparison

All figures checked **2026-08-26**. Every cell links to the page it came from in
[Sources](#sources). "Not published" means the vendor does not publish it — not
that it is free.

| Provider | Base / segment | Number / mo | 10DLC brand (one-time) | Campaign / mo | Registration turnaround | Monthly minimum |
|---|---|---|---|---|---|---|
| **Telnyx** | **$0.0040** | from $1.00 | $4.50 | $10 (std) / $1.50 low-vol | ~72 business hrs carrier review after Telnyx's own review (unpublished) | **None** |
| **AWS End User Messaging** | $0.00581 | $1.00 | $4.50 | $10 (std) / $2 low-vol | Usually instant; **up to 4 weeks** if TCR queries | **None** |
| **Bandwidth** | $0.0060 | not published (~$0.35 secondary) | $9.00 | $20 (std) / $3 low-vol | not published | 3-month commitment per campaign |
| **Plivo** | $0.0077 | $0.50 | $4.50 | $10 (std) / $1.50 low-vol | "Days" (no SLA) | **$1,000/mo Enterprise plan** |
| **Twilio** | $0.0083 | $1.15 | $44 std / $4–4.50 low-vol | $1.50–$10 | Twilio says "under one week"; reported 2–6 weeks in practice | **None** |
| **Vapi** | $0.005 **on top of Twilio** | via Twilio | via Twilio | via Twilio | inherits Twilio's | Build plan none; Scale plan unpublished |
| **Bird (ex-MessageBird)** | **not published** | not published | not published | not published | not published | unknown |
| **Push (today)** | **$0.00** | — | — | — | none | **None** |

### Carrier pass-through fees stack on top of every row

US carriers bill A2P messages directly; the provider passes the fee through.
This is charged **in addition** to the base rate above, and is the most commonly
omitted line in provider marketing. From Twilio's live table (the most current
of the published sets):

| Carrier | Per SMS segment |
|---|---|
| AT&T | $0.0035 |
| T-Mobile | $0.0045 |
| Verizon | $0.0045 |
| US Cellular | $0.0050 |
| All others | $0.0040 |

The cost model below applies a **blended $0.0042 per segment** uniformly to
every provider. Carrier fees are set by the carriers, not by the providers, so
applying one provider's lower published estimate to only that provider would
flatter it unfairly.

**The blend is a stated assumption, not a sourced figure.** It weights the table
above by approximate US wireless subscriber share:

```text
0.35 × $0.0045  (Verizon)      = $0.001575
0.33 × $0.0045  (T-Mobile)     = $0.001485
0.30 × $0.0035  (AT&T)         = $0.001050
0.02 × $0.0050  (US Cellular)  = $0.000100
                          blend ≈ $0.0042
```

Those shares are round approximations, not a cited market-share report, and our
actual user mix is unmeasured. Treat $0.0042 as the midpoint of a **$0.0035 –
$0.0050 range**: at the low end the 500/day Telnyx figure falls to about
$123.50/mo, at the high end it rises to about $146.00/mo, against $134.00 at the
midpoint. The provider *ranking* is unaffected, because the same blend applies to
every row.

> **Conflict worth knowing:** Telnyx's fee article lists AT&T and T-Mobile at
> $0.0030 while Twilio's live table lists $0.0035 and $0.0045. T-Mobile raised
> A2P pass-through fees effective January 2026; the Telnyx page appears to
> predate that. Budget against the higher figures.

### Notes that matter more than the base rates

- **Plivo is effectively disqualified.** SMS moved behind a **$1,000/month
  Enterprise plan**; the attractive $0.0077 rate is unreachable below that. At
  our scale we would pay $1,000/mo for ~$18 of traffic.
- **Bird publishes no US SMS rate at all** — sales-quote only. Secondary sources
  disagree by ~2.5x ($0.0033 to $0.0083), so no Bird number belongs in a cost
  model. Recorded as "quote-only".
- **Vapi is not an SMS provider.** This is the most important correction to the
  issue's premise. Vapi has no SMS transport of its own: its SMS Chat surface is
  *inbound-initiated only* ("assistants cannot send the first message"), and its
  Send Text tool is an in-call side-channel that requires **your own
  10DLC-approved Twilio number**. Routing through Vapi costs Vapi's $0.005
  **plus** the full Twilio bill — the most expensive option on the board. Our
  existing Vapi account and number buy us nothing here.
- **AWS's legacy SNS SMS pricing page still resolves** with no migration notice.
  End User Messaging is the current product; cite that one.

## All-in monthly cost at three scales

Monthly segments = daily reminders × 30. Monthly total = monthly segments ×
(base + blended carrier fee) + number rental + campaign fee. One-time
registration is excluded from the monthly figure and shown in its own column.

| Option | All-in / segment | 50/day (1.5k/mo) | 500/day (15k/mo) | 5,000/day (150k/mo) | Year-1 registration |
|---|---|---|---|---|---|
| **Push (do nothing)** | **$0** | **$0** | **$0** | **$0** | none |
| **Telnyx** | $0.0082 | **$23.30** | **$134.00** | **$1,241.00** | $19.50 |
| **AWS EUM** | $0.0100 | $26.00 | $161.00 | $1,511.00 | $4.50 |
| **Bandwidth** | $0.0102 | $35.65 | $173.35 | $1,550.35 | $9.00 + 3-mo commit |
| **Twilio** | $0.0125 | $29.90 | $198.65 | $1,886.15 | $59.00 |
| **Plivo** | $0.0119 | $1,028.35 | $1,189.00 | $2,795.50 | $19.50 |
| **Vapi (→ Twilio)** | $0.0175 | $37.40 | $273.65 | $2,636.15 | $59.00 (via Twilio) |
| **Bird** | quote-only | — | — | — | unknown |

Worked example, Telnyx at 500/day: `500 × 30 = 15,000` segments;
`15,000 × ($0.0040 + $0.0042) = $123.00` variable; `+ $1.00` number
`+ $10.00` campaign = **$134.00/mo**.

Year-1 registration is one-time and small enough to be a rounding error above
50/day: Telnyx's $19.50 is $1.63/mo amortized, against a $134/mo bill at
500/day. It is listed for completeness, not because it changes a decision.

At 50/day, dropping to a Low-Volume Standard campaign ($1.50/mo instead of $10)
brings Telnyx to **$14.80/mo** — but see the throughput ceiling below.

### The throughput ceiling nobody prices

Cost is not the binding constraint at the top scale; **registration tier is**.

- A **Sole Proprietor** brand is capped at **3,000 SMS segments/day** (with a
  1,000/day sub-limit to T-Mobile) and **1 message per second**, 1 campaign,
  1 number. **The 5,000/day scenario is not reachable on a sole-proprietor
  registration at any price.**
- 5,000 reminders is also a *burst* problem, not just a daily one. Reminders are
  clustered at user-chosen local times; if a meaningful share pick 6pm and share
  a timezone, a single 5-minute cron tick could need ~17 msg/sec sustained. That
  requires a Standard brand with a decent vetting score, not the entry tier.
- **Low-Volume Standard** requires a Tax ID but gives higher throughput than
  Sole Proprietor at the same $4–4.50 brand fee — the right tier for the
  50–500/day range.

### International

Out of scope, and a genuine cliff rather than a gradient: per-destination rates
commonly run 2–10x US, several countries require separate sender-ID
registration, and some prohibit unregistered A2P entirely. If the user base is
not US-concentrated, every figure above understates the bill.

## Recommendation

**Do not build SMS now. Measure the three notification channels we already ship
before adding a fourth. If and when we do build it, use Telnyx.**

### Why not now

The cost is not the objection. **$23–30/month at our likely scale is
affordable**, and Telnyx at 500/day is $134/mo — real, but not disqualifying.
Three other things are the objection.

**1. We have three nudge channels and zero evidence about any of them.** Push,
web push, and — since July 2026 — an outbound phone call (#599). The call is a
*stronger* intervention than a text and it shipped seven weeks ago with no
measurement of whether it changes sit rates. Adding a fourth channel before
learning whether the third one worked is spending money to avoid answering a
question. If the call moves the needle, SMS is redundant; if it doesn't, SMS
probably won't either, and the problem isn't the channel.

**2. The compliance surface is permanent, and larger than the feature.** SMS is
the only channel here that is *regulated*. It brings 10DLC registration, a
STOP/HELP webhook (which this codebase has no precedent for — `src/app/api/`
contains no webhook route of any kind), a consent-evidence burden our current
pattern actively undermines by deleting the record on opt-out (see Compliance),
an FCC requirement to honor opt-outs received by *any* reasonable method within
10 business days, and an 8am–9pm recipient-local send window that our nullable
quiet-hours columns do not enforce. That is ongoing liability for a
solo-maintained app, and it does not go away when the feature stops being
interesting.

**3. Registration lead time means it cannot ship reactively anyway.** Twilio's
own page says "under one week"; practitioners report 2–6 weeks for full
multi-carrier approval, and AWS warns of up to 4 weeks if the registry queries
the brand. Whatever we decide, the clock starts weeks before the first text.

### What a text buys that a push doesn't — honestly

The strongest argument *for* SMS is engagement asymmetry: Airship's analysis of
~50 billion notifications puts direct iOS push reaction around **4.9%**, while
SMS open rates are conventionally cited near **98%**.

That gap is real but overstated for our case. The 98% figure counts a
lock-screen glance as an "open" and comes from marketing-industry sources with
an interest in the number. Push open rates run low *by design* — a user who
reads "time to sit" on the lock screen and opens the app directly never
registers as an open. And our users have **already opted into** push reminders,
so they are not the disengaged average that benchmark describes. The honest
summary: a text is meaningfully harder to ignore than a push, by an unknown
multiple, for a recurring per-message cost and a permanent compliance
obligation. That is a reasonable bet to make *with* data and a poor one without.

### If we build it: Telnyx

- **Cheapest published all-in** ($0.0082/segment) of any self-serve provider,
  ~35% under Twilio.
- **No monthly minimum**, unlike Plivo's $1,000/mo floor.
- **Passes 10DLC fees through at cost** with no markup (stated on their fee page).
- **Cheapest registration**: $4.50 brand vs Twilio's $44 for a Standard brand.
- Runner-up is **AWS End User Messaging** — $0.0100/segment, no minimum, fully
  self-serve, and worth preferring if we later want the rest of the AWS estate.
  Twilio's only real advantage is documentation quality, and it costs ~50% more
  per segment to buy it.

## Integration sketch (describe only — nothing here is implemented)

Mapped onto the existing "Adding a notification type" checklist in
`docs/notifications.md`.

### Schema — `notification_preferences`

```text
smsOptIn        boolean   default false not null   -- mirrors callOptIn
smsPhoneNumber  varchar(20)                        -- E.164, mirrors callPhoneNumber
smsConsentAt    timestamptz                        -- see Compliance: NOT a callConsentAt copy
smsVerifiedAt   timestamptz                        -- new; no precedent (see Compliance)
```

**Separate `smsPhoneNumber` rather than reusing `callPhoneNumber`.** They are
independently revocable: a user may STOP texts while keeping calls, and a
carrier-level STOP suppresses only the SMS channel. Sharing one column would
make an SMS opt-out silently look like a call opt-out, and would force the two
consent records to share a lifecycle they do not have. The `varchar(20)` width
and `isValidE164PhoneNumber()` validator carry over unchanged.

The ledger needs **no schema change**. `notification_type` is `varchar(50)`, so
a new `"sms_reminder"` value fits inside the existing unique index on
`(userId, notificationType, windowKey)`.

### Scheduler — a dedicated pass, not a fan-out task

Add a third pass to `dispatchDueNotifications()` in
`src/lib/notification-scheduler.ts`, modeled on the existing `callCandidates`
loop, **not** a task inside `fanOutChannels()`.

Reasoning, from the findings above: the push pass is gated on
`pushEnabled = true`, so an SMS-only user would never be scanned; and
`fanOutChannels()` runs every task unconditionally and returns `some(delivered)`,
so an SMS task there would text everyone on the daily reminder with no opt-in
gate and would mark the ledger claim satisfied even when push failed. A
dedicated pass keeps SMS independently gated, independently windowed, and
independently observable in the cron's return counters.

Its candidate query selects on `eq(notificationPreferences.smsOptIn, true)` —
**not** joined to `pushEnabled` — exactly as the call pass selects on
`callOptIn`. That is the whole point of the separate pass: an SMS-only user must
be reachable.

The pass reuses, unchanged:

- `getLocalParts(now, prefs.tz)` for timezone resolution
- `evaluateReminderDispatchWindow(...)` for the due check **including quiet
  hours** — deliberately preferred over the call pass's
  `evaluateMissedSitCallDue()`, which does not consult quiet hours at all
- `addCalendarDays(local.dateKey, dayOffset)` for the cross-midnight correction
- `userCompletedSessionOnDate()` to skip users who already sat
- `claimNotificationDispatch({ userId, notificationType: "sms_reminder",
  windowKey: intendedDateKey })` for idempotency, plus a
  `releaseSmsReminderClaim()` on send failure, matching the three existing
  release helpers

**`dailyReminderTime` + `tz` already provide the "6pm text".** The issue's open
question is resolved: per-user send time is existing capability, configuration
only, zero new work.

### Send client — `src/lib/sms.ts`

Model on `src/lib/vapi.ts`: a `REQUIRED_SMS_ENV_VARS` list, a
`getSmsConfigStatus()` surfaced in the cron response the way
`getApnsConfigStatus()` already is, a 10-second `AbortSignal.timeout`, and a
discriminated `{ ok: true } | { ok: false; reason }` result. Add an
`sms_attempts` table mirroring `call_attempts` (userId, phone, windowKey,
status, providerMessageId, errorMessage) so delivery failures are inspectable
rather than swallowed.

### Push-vs-SMS stacking

**Default: independent opt-ins**, matching the flat `callOptIn` model and
needing no new logic. A user who enables both gets both.

If product prefers an **escalation ladder** (push → text → call), the mechanism
already exists in precedent form: `hasMissADayDispatchForDate()` shows the
cross-type read-check pattern — query `notification_dispatches` for a *different*
`notificationType` at the same `windowKey` and skip if present. An SMS pass
would check for a `daily_reminder` row on `intendedDateKey` before sending, and
the call pass would check for `sms_reminder`. It is maybe 15 lines per stage,
but it makes the passes order-dependent within a single cron tick, which is the
real cost. Recommend shipping independent opt-ins first.

### UI

The call feature (#599) shipped **iOS-only** — `callOptIn` appears in the API
route and iOS settings, with no web control. SMS should match that scope to stay
consistent, or both should be added to web together as a separate piece of work.

## Compliance

SMS is the only channel here that is regulated. Four requirements, and an honest
account of where the `callConsentAt` pattern transfers.

### 1. Opt-in consent record — the pattern does **not** transfer

`src/app/api/notifications/preferences/route.ts` sets `callConsentAt` on a
false→true transition and **`null`s it on opt-out**:

```ts
if (!existing.callOptIn) {
  updates.callConsentAt = new Date();
}
} else if (existing.callOptIn || updates.callOptIn === false) {
  updates.callConsentAt = null;
}
```

That is backwards, though it is worth being precise about why — the distinction
between what is *required* and what is *prudent* matters here.

**The statutory position.** The TCPA does not itself impose a fixed
consent-retention period. What it does impose is a **four-year statute of
limitations** (28 U.S.C. § 1658), which means a claim can be brought about a
message sent four years ago — and the defendant carries the burden of proving
consent. Retention guidance of "the relationship plus four to five years" is the
industry's response to that burden, not a quoted regulation. Separately, where
the FTC's Telemarketing Sales Rule applies, it carries its own explicit
record-keeping obligations; whether it reaches us depends on whether our
messages are telemarketing, which they are not obviously.

**Why the current code is still wrong.** Under any of those readings, nulling
the column destroys the only evidence we hold, at exactly the moment it becomes
useful — and it destroys the *revocation* record too, so we could not show when
someone opted out either. That is a self-inflicted problem regardless of which
retention theory applies.

**Required vs recommended in the record's shape.** A bare timestamp is thin. The
disclosure language the user agreed to and the opt-in method are the fields that
actually evidence consent, and are worth treating as required. An IP or session
identifier is **recommended corroboration, not a legal requirement** — and it is
personal data, so capturing it creates its own retention and access obligations
rather than being free. Decide deliberately.

**This is a live gap in the shipped #599 call feature, not a hypothetical SMS
one** — automated voice calls to mobile numbers carry their own prior-express-
written-consent requirements. Filed as a follow-up below.

For SMS: an append-only `sms_consent_events` log (`userId`, `phoneNumber`,
`event: granted|revoked`, `disclosureVersion`, `method`, `ip`, `createdAt`), with
`smsConsentAt` on the preferences row as a denormalized read cache.

### 2. STOP / HELP keyword handling

Providers auto-handle the standard keywords at the platform level — STOP,
UNSUBSCRIBE, END, QUIT, CANCEL, STOPALL, REVOKE, OPTOUT, and HELP — and Twilio
returns error `21610` on a send to a number that has opted out. **Platform
handling is necessary but not sufficient:**

- The app must consume the opt-out webhook and persist its own suppression
  state. Otherwise our database says "opted in" while the carrier blocks
  delivery: the settings screen shows a lie, and we keep paying for rejected
  sends.
- Since **April 11, 2025** the FCC requires honoring opt-out requests made by
  *any reasonable method* — email, a phone call, a web form, a chatbot — not
  only text keywords, and within **10 business days**. A keyword-only
  implementation is non-compliant by construction.

`src/app/api/` currently contains **no webhook route of any kind**, so the
inbound handler is genuinely new infrastructure (signature verification,
idempotency, a public unauthenticated endpoint), not a variation on something
already here.

### 3. Quiet hours — applies, but is not inherited

Two distinct problems:

- **It is not inherited.** `evaluateMissedSitCallDue()` never consults quiet
  hours; only the push path does. An SMS pass copied from the call pass would
  have no quiet-hours enforcement at all. The sketch above deliberately reuses
  `evaluateReminderDispatchWindow()` instead.
- **User config is not a compliance control.** `quietHoursStart` and
  `quietHoursEnd` are nullable with no default, and `isInQuietHours()` returns
  `false` when either is null — so **by default there are no quiet hours**. That
  is fine for a push, which is silent-by-default on a locked phone and costs
  nothing. A 3am text is a different matter.

  The commonly cited **8am–9pm recipient-local window** comes from
  47 CFR § 64.1200(c)(1), which by its terms governs *telephone solicitations* —
  telemarketing. A reminder a user asked us to send is arguably not a
  solicitation, so it is **not settled** that the window binds us as a matter of
  law. It is, however, the near-universal industry and carrier-guideline
  expectation, and the cost of honoring it is nil. **Treat it as a conservative
  product policy**: enforce a hard 8am–9pm floor independent of user preference,
  intersected with (never replaced by) the user's own quiet hours, and have
  counsel confirm whether the statutory window applies before relying on the
  distinction.

### 4. Phone verification — no precedent exists

`isValidE164PhoneNumber()` validates **format only**. Nothing confirms the user
controls the number they typed. A mistyped digit means we text a stranger who
never consented — and our consent record would name a number whose owner never
saw the disclosure, which is precisely the situation the consent log exists to
prevent.

A one-time-code round-trip before `smsOptIn` can be set true is the standard
control for this, and is **strongly recommended**. It is not, as far as this
investigation could establish, a specific statutory mandate; treat it as a
wrong-number risk control rather than a compliance checkbox, and have counsel
confirm before scoping it as legally required. Either way there is no existing
pattern for it in the codebase, so it is net-new work that should be budgeted.

## Implementation estimate (if the recommendation is reversed)

Sized against the actual shipped footprint of the #599 missed-sit call, which is
the closest analogue we have — same ledger, same scheduler, same consent shape.

| PR | Scope | Size |
|---|---|---|
| #654 | schema + preferences API | 282 lines, 6 files |
| #655 | Vapi client + `call_attempts` | 339 lines, 5 files |
| #656 | iOS settings UI | 292 lines, 5 files |
| #657 | scheduler dispatch pass | 211 lines, 2 files |
| #659 | docs + cron test | small |

**~1,124 lines across four substantive PRs.** SMS maps onto the same
decomposition, and is *simpler* in the send client (no assistant config or
variable injection) but carries two pieces #599 never needed:

- **An inbound STOP/HELP webhook** — new route, new signature verification, no
  precedent in this codebase.
- **A phone-verification round-trip** — also no precedent.

**Estimate: 5–6 PRs, ~1,400–1,700 lines, `size:L` overall**, plus **1–6 weeks of
10DLC registration lead time** that can run in parallel with development but
gates the first real send. The consent-log rework should land first regardless,
since it is a live gap today.

## Decision record

**Recorded decision (2026-08-26): do not build SMS reminders at this time.**
No SMS implementation issues filed. This document is the record required by the
#672 test plan.

Revisit when either of these is true:

1. We have measured whether the existing push / web-push / call channels change
   sit rates, and the answer indicates a gap a text would fill; or
2. Product decides the escalation ladder (push → text → call) is the intended
   product shape, in which case the text is a *replacement* for the call's
   bluntness rather than a fourth parallel channel.

Two follow-ups are filed — neither is an SMS build:

- **[#674 — Consent audit trail: `callConsentAt` is destroyed on opt-out](https://github.com/auerbachb/still-point/issues/674)**
  — a live gap in the already-shipped #599 call feature, independent of the SMS
  decision.
- **[#675 — Measure notification effectiveness before adding a fourth channel](https://github.com/auerbachb/still-point/issues/675)**
  — the measurement that gates revisiting this decision.

## Sources

All checked 2026-08-26.

**Provider pricing**
- Twilio — [US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us) · [A2P 10DLC](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc) · [pricing](https://www.twilio.com/en-us/pricing)
- Telnyx — [messaging pricing](https://telnyx.com/pricing/messaging) · [number pricing](https://telnyx.com/pricing/numbers) · [10DLC fees](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges) · [campaign compliance guide](https://support.telnyx.com/en/articles/16256133-10dlc-campaign-compliance-guide)
- AWS — [End User Messaging pricing](https://aws.amazon.com/end-user-messaging/pricing/) · [Connect pricing appendix](https://aws.amazon.com/products/connect/customer/pricing/appendix/) · [10DLC registration process](https://docs.aws.amazon.com/sms-voice/latest/userguide/registrations-10dlc-setup.html)
- Bandwidth — [pricing](https://www.bandwidth.com/pricing/) · [10DLC fees](https://www.bandwidth.com/support/en/articles/12823086-10dlc-fees)
- Plivo — [SMS pricing](https://www.plivo.com/sms/pricing/) · [plans](https://www.plivo.com/pricing/) · [10DLC overview](https://www.plivo.com/docs/messaging/api/10dlc/overview)
- Bird — [SMS pricing](https://bird.com/en-us/pricing/sms) · [pricing](https://bird.com/pricing) (no US rate published)
- Vapi — [pricing](https://vapi.ai/pricing) · [SMS chat](https://docs.vapi.ai/chat/sms-chat) · [inbound SMS](https://docs.vapi.ai/phone-numbers/inbound-sms) · [default tools](https://docs.vapi.ai/tools/default-tools)

**Registration tiers, carrier fees, compliance**
- [Salesmate — Starter vs Low Volume Standard vs Standard 10DLC](https://support.salesmate.io/hc/en-us/articles/22587396525209-Comparison-between-Starter-Low-Volume-Standard-and-Standard-registration-for-A2P-10DLC) (sole-proprietor throughput caps)
- [Telgorithm — T-Mobile 2026 A2P pass-through fees](https://www.telgorithm.com/news/t-mobile-announces-new-2026-a2p-sms-pass-through-fees)
- [Infobip — TCPA compliance for SMS](https://www.infobip.com/blog/tcpa-compliance-sms) · [IDT Express — TCPA 2026 guide](https://www.idtexpress.com/blog/tcpa-compliance-for-sms-in-2026-the-complete-guide-for-us-businesses/) (consent retention practice, FCC April 2025 revocation rule)
- Primary law referenced in Compliance, for the reader who needs to check the
  secondary sources above: [47 CFR § 64.1200](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200)
  (the 8am–9pm window at (c)(1), scoped to *telephone solicitations*) and
  [28 U.S.C. § 1658](https://www.law.cornell.edu/uscode/text/28/1658) (the
  four-year statute of limitations that drives retention practice).

**Engagement benchmarks**
- [MobiLoud — push notification statistics](https://www.mobiloud.com/blog/push-notification-statistics) (Airship ~4.9% iOS reaction rate)
- [Omnisend — SMS vs push](https://www.omnisend.com/blog/push-notifications-vs-sms/)

> **On the Compliance section.** It is an engineering summary, not legal advice.
> It deliberately separates what appears to be required from what is merely
> prudent, and flags the places where that line is genuinely unclear for
> non-solicitation messages. Anything we would rely on should be confirmed with
> counsel before it becomes implementation scope.

> **On the cost model.** The $0.0042 blended carrier fee is a stated assumption
> with the arithmetic shown, not a sourced figure; the $0.0035–$0.0050 range and
> its effect on the totals are given alongside it. Every base rate, number
> rental, and registration fee *is* traceable to the linked page.

> **Reproducibility note.** Two figures could not be sourced to a published
> vendor page and are marked in-table: Bandwidth's local number rental (secondary
> source only) and every Bird figure (none published). Twilio's canonical 10DLC
> help article is JS-rendered and returned 403/empty; its fees are cited from
> Twilio's own marketing and docs pages instead, and the brand-registration fee
> carries a known $4 vs $4.50 discrepancy between those pages and secondary
> sources — plan against $4.50.
