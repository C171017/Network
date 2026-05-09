# “Impossible to load all of GitHub?” + one crawl for two use cases

## Do we have everything on GitHub?

No. The public graph is huge, API calls are metered, and you only need a **representative slice** for a prototype. We **sample** instead of mirroring.

## Starting from your account

Yes — use **your** username as the first seed (`SEED_LOGIN`) while you test. For the pitch, run the **same script** for a few volunteers so the DB already contains their neighborhood when they log in (or show a pre-recorded account).

## One mechanism, reused later

The crawler package calls GitHub’s **official JSON API** (not HTML scraping). The same `runStochasticCrawl` function can run:

1. **On your laptop** — participants authorize a token once, you write into `data/network.db`; or  
2. **On the server later** — after OAuth, a background job uses their token and writes to Postgres instead of SQLite when you wire that in.

## What it does (in plain language)

At each person, look at **who follows them and who they follow**, take a **random handful (6 for now)** from the first pages of those lists, record them, then repeat for each new person — up to **5 depth layers** from the starting user, with a safety cap so we do not burn the whole API quota.

Details and tradeoffs (early-page bias, rate limits): [`../agents/stochastic-crawl-mechanism.md`](../agents/stochastic-crawl-mechanism.md).
