# ASSIGNMENT.md — WePush Take-Home Brief (verbatim)

Status: REQUIREMENTS. This is the brief exactly as received. Do not edit it to match the
implementation — if the implementation deviates, record why in `DECISIONS.md`.

---

WePush runs a fullstack creator marketplace: web frontend, an application server, backend
services, and scheduled jobs, all deployed and operated in production. This exercise asks
you to build a small, realistic slice of that, and to treat it like something that has to
actually work, not just run once on your laptop.

## The feature

A two-sided marketplace where advertisers run campaigns, creators get matched to them, and
pricing is settled through bidding.

Advertisers create campaigns with a budget, a bidding deadline, creator requirements, and
commercial goals such as a target CPM. You decide which parameters matter.

Creators have TikTok or Instagram profiles with things like genre, followers, and
engagement. They see the campaigns matched to them, ranked, and with enough context to
decide whether to bid and how much. Then they place bids and track them.

Pricing is yours to design across the whole marketplace: how an advertiser's goals translate
into what a creator should charge, and how bids get judged against both.

Closing: a scheduled job closes campaigns once their deadline passes and picks winners
within budget.

No auth is needed. The user picks who they're acting as. Matching, pricing, bidding, and
closing have to be real, and the full loop has to work through the UI without touching the
database.

## What to submit

- A git repo with the frontend, application server, and scheduled worker
- A README covering how to run it, how your matching and pricing work and why, and how
  you'd run this in production
- How much infrastructure you add is up to you. We want to see what you decide is worth
  doing.

## How we'll grade it

- **Architecture & code quality:** service boundaries, data model, where the logic lives,
  correctness of the closing job, and your infrastructure choices
- **Product sense:** does it help both sides make good decisions, and did you choose well
  what to build and what to skip
- **Marketplace design:** are your matching and pricing rules sensible, explainable, and
  honest about their limits

AI coding tools are expected and encouraged. We care about the decisions behind what you
shipped.
