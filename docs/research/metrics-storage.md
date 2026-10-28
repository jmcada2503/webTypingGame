# Research: Metrics storage and saved queries

Ticket: #42 (map #38). Researched 2026-10-28. Region `us-east-1`. No AWS account touched; all prices from AWS pages/docs/launch posts or secondary sources as flagged. **Nothing here was run against AWS** (queries are untested drafts).

## TL;DR

- **Recommend: structured JSON log lines in CloudWatch Logs, queried with Logs Insights saved queries.** Lambda just `console.log`s one JSON line per Match. No extra infra, no write API calls, no batching needed. Free at 10 and 100 concurrent; ~$3-4/month worst case at 1,000.
- **Do not use DynamoDB for metrics.** No aggregation (every "count per day" = client-side scan script), writes are billed per KB with no free request tier ($7/month at 1,000 worst case), and a GSI doubles the write cost. Keep DynamoDB for the future accounts/rankings effort, where it fits.
- **Escape hatch (same JSON schema):** when volume nears the 5 GB/month free log allowance, or retention beyond ~1 year is wanted, add a Logs subscription filter -> Firehose -> S3 -> Athena. Queries port to SQL.
- Biggest caveat: new AWS accounts (created on/after 2025-07-15) are on the Free Plan, which **closes the account after 6 months** unless upgraded to Paid. See "Free tier".

## Assumptions (cost model)

Not measured; adjust later.

- Match ~2 min. Each concurrent player is in a Match ~70% of the time. So each concurrent player yields ~10.5 Matches/hour (21 player-Matches/h, 2 players per Match), i.e. **~7,500 Matches/month per 1 concurrent player** if load is sustained 24/7. This is a deliberate **worst case**; real traffic (a few busy hours/day) is probably 3x lower or less.
- Per Match all-in volume: one Match summary (~1.2 KB JSON) + folded-in share of Practice results, Matchmaking give-ups, peak-online samples = **~1.5 KB per Match-equivalent, ~1.5 records**.

| Concurrent | Matches/month (worst) | Log/data volume/month | Records/month |
|---|---|---|---|
| 10 | 75 k | ~0.11 GB | ~110 k |
| 100 | 750 k | ~1.1 GB | ~1.1 M |
| 1,000 | 7.5 M | ~11 GB | ~11 M |

Realistic (1/3 of worst): 0.04 / 0.4 / 3.7 GB.

## Free tier status (new accounts, as of 2026-10-28)

- Accounts created on/after **2025-07-15** use the new model: choose **Free Plan** or **Paid Plan** at signup. $100 credit at signup, up to $200 total (+$20 each for: launch/terminate EC2, configure RDS, Lambda function URL, Bedrock prompt, **AWS Budgets alert**). Legacy 12-month trials do not apply. ([AWS blog](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/))
- **Free Plan expires after 6 months or when credits run out, whichever first; the account closes**, with 90 days to reopen by upgrading to Paid. Unused credits stay valid up to 12 months from signup. Paid Plan = all services, billed beyond credits.
- **Always-free allowances exist on both plans** ("30+ services") but the official pages I could load do not enumerate them. What the pricing pages themselves state:
  - CloudWatch: **5 GB** logs (ingestion + archive storage + Insights scan), **10 custom metrics**, 10 alarms, 3 dashboards. ([CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/))
  - DynamoDB: **25 GB storage** (Standard table class). **No free on-demand request units** (the free request tier is provisioned WCU/RCU only). ([DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/))
  - Athena, Firehose: **no free tier** found. S3 5 GB/20k GET/2k PUT free tier is only from a third-party post, not confirmed on the page.
- Unverified: whether Free Plan blocks Firehose/Athena ("some enterprise services unavailable"). Check in the console before relying on the S3/Athena path on the Free Plan.
- Implication: plan the $0 target for the **Paid Plan after month 6** (credits then gone; only always-free allowances remain). Credits will also hide real spend for 6 months; check whether the $1/$3/$5 budget alerts count gross or net-of-credit cost (not verified).

## Prices used (us-east-1)

| Item | Price | Source |
|---|---|---|
| DynamoDB on-demand write / read | $0.625 / $0.125 per million (1 WRU per KB written, 1 RRU per 4 KB strongly consistent read, half eventual) | DynamoDB pricing page |
| DynamoDB storage | $0.25/GB-mo Standard (25 GB free), $0.10 Standard-IA | same |
| DynamoDB TTL delete | no write cost; happens "typically within a few days" after expiry | [DynamoDB TTL doc](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) |
| DynamoDB PITR / export-to-S3 | $0.20/GB-mo PITR (export needs PITR) | pricing page |
| CloudWatch Logs ingest (Standard) | $0.50/GB (5 GB free) | CloudWatch pricing examples |
| CloudWatch Logs storage | $0.03/GB-mo | same |
| Logs Insights | $0.005 per GB scanned (5 GB free) | [launch post](https://aws.amazon.com/blogs/aws/new-amazon-cloudwatch-logs-insights-fast-interactive-log-analytics/) (secondary sources agree; official table did not render) |
| CloudWatch custom metric (EMF) | $0.30/metric-month (10 free) | CloudWatch pricing |
| Firehose Direct PUT | $0.029/GB, **each record rounded up to 5 KB** | [Firehose pricing](https://aws.amazon.com/kinesis/data-firehose/pricing/) |
| Athena | $5/TB scanned, 10 MB min/query (assumed standard; examples on the page) | [Athena pricing](https://aws.amazon.com/athena/pricing/) |
| S3 PUT / storage | $0.005 per 1k PUT, ~$0.023/GB-mo (from memory, page table did not render) | - |

## Options compared

### A. CloudWatch Logs (JSON lines) + Logs Insights  **(recommended)**

- **Write path:** `console.log(JSON)` from the Lambda that learns the Match ended. Stdout is shipped by Lambda to CloudWatch asynchronously: no SDK call, no added billed duration, no IAM beyond the default log role, **no batching to design**. One line per event.
- **Gotcha:** the Lambda text log format prefixes each line (timestamp, request id, level), which breaks JSON field discovery. Use Lambda **Advanced logging controls -> JSON format** (fields then appear under `message.*` for `console.log(object)`), or a dedicated metrics log group written in plain JSON. Verify at implementation.
- **Gotcha:** the free 5 GB is shared with **all** app Lambda logs (WebSocket/matchmaking handlers). Keep app log level at WARN/INFO-minimal; set `retention` explicitly in CDK (default is never expire).
- **Cost (worst case):**
  - 10 concurrent: 0.11 GB -> **$0**.
  - 100: 1.1 GB -> **$0** (inside 5 GB; ~$0.55 if shared with chatty Lambda logs eating the pool).
  - 1,000: 11 GB ingest -> (11-5) x $0.50 = $3.1, + 90-day storage ~34 GB x $0.03 ~ $1 (upper bound; billed compressed, and 5 GB free) -> **~$3-4/month**. Realistic 1/3 load: ~$0.
  - Queries: scan 1 month at 1,000 = 11 GB x $0.005 = $0.06. 90 days = $0.17. Negligible.
- **Query ergonomics:** good for time ranges (`bin(1d)`, `bin(1w)`, built-in time picker), `stats`, `pct`, `unnest` for arrays ([unnest doc](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Unnest.html), needs `jsonParse`). **Saved queries are first-class** (console "Saved queries"; CDK `logs.CfnQueryDefinition`), so the saved-query ask is met in IaC. Limits: no joins (so "returning player" must be a flag written at event time, see schema), 10,000 result rows, 200 JSON fields per event, scan cost grows with the time range.
- **Retention:** per-log-group setting. 90 days is ~free at <=100 concurrent; can go 400 days/never at low volume ($0.03/GB-mo).
- **Optional EMF:** emit 2-3 low-cardinality metrics (matches by kind, online count, peak) for graphs and the 15-month metric retention, within the 10 free metrics. Avoid per-language x per-kind x per-anything dimension explosions: each unique dimension set is a billed metric.
- **Accounts/rankings:** weak as a source of truth (retention-bound, no updates, no joins) but fine as raw telemetry. Rankings must not be computed from logs.

### B. DynamoDB (one item per Match, TTL, optional GSI)

- **Write path:** `PutItem` from the Lambda. `BatchWriteItem` only cuts HTTP calls, **not** WRUs (billed per item per KB), so it does not lower cost; to save money merge events into the Match item and keep it <=1 KB.
- **Cost (worst case, no GSI, 1.5 writes per Match-equivalent):**
  - 10: 110 k writes x $0.625/M = **$0.07**
  - 100: 1.1 M -> **$0.70**
  - 1,000: 11 M -> **$7.0**, already over the $5 cap by itself. Storage 11 GB/month; with 30-day TTL stays under 25 GB free (90-day TTL ~34 GB -> +$2.3). Reads: dumping a month at 1,000 ~ 11 GB / 8 KB per eventual RRU ~ 1.4 M RRU ~ $0.17.
  - A GSI adds 1 WRU per write and projected storage: roughly **doubles** write cost.
- **Query ergonomics:** weakest. No GROUP BY/COUNT by range; PartiQL does not aggregate. Needs a day-bucketed key (`PK = D#2026-10-28`, `SK = ts#matchId`) and a script that pages and aggregates client-side. "Saved queries" = scripts in the repo, not stored queries. Hardest-words needs a second per-word table or another script.
- **Retention:** TTL is free but lazy (days).
- **Accounts/rankings:** best fit of the options (keyed lookups by player, conditional updates, leaderboards via GSI). But that is a different table design; do it in the accounts effort, not as the metrics sink.

### C. S3 + Athena, fed by Firehose

- **Write path:** Lambda `PutRecord(Batch)` to Firehose (SDK call in the request path, ~tens of ms billed, IAM, error handling). Firehose buffers (60-900 s) and writes batched objects to S3. Writing one S3 object per Match directly is a trap: 7.5 M x $0.005/1k = **$37/month** at 1,000.
- **Cost (worst case):** Firehose bills 5 KB min per record: 10: 110 k x 5 KB = 0.55 GB -> $0.02; 100: 5.5 GB -> **$0.16**; 1,000: 55 GB -> **$1.6**. S3 storage 11 GB x $0.023 ~ $0.25. Athena scan 1 month JSON = 11 GB x $5/TB = $0.06 (Parquet conversion $0.018/GB in Firehose cuts scans further but adds a Glue schema). Total: ~**$0.02 / $0.2 / $2**. Cheapest at 1,000. No free tier, so >$0 from the first event.
- **Query ergonomics:** best (full SQL, joins, window functions, UNNEST), partition projection by date avoids crawlers. Cost of that: Glue table + Athena workgroup + results bucket + partition-projection DDL in CDK, and queries are not "saved" as nicely (Athena named queries exist; less convenient).
- **Latency:** 1-15 min delay before data is queryable. Fine for this use.
- **Accounts/rankings:** good for analytics/backfill, not for serving rankings.
- Risks: possibly unavailable on Free Plan (unverified); more moving parts than a collect-only phase justifies.

### D. Others (dismissed)

- **Timestream for LiveAnalytics:** closed to new customers since 2025-06-20 ([AWS doc](https://docs.aws.amazon.com/timestream/latest/developerguide/AmazonTimestreamForLiveAnalytics-availability-change.html)). Timestream for InfluxDB, RDS/Aurora Serverless: always-on minimum cost, not ~$0; not researched further.
- **DynamoDB + export to S3 + Athena:** needs PITR ($0.20/GB-mo) and export fees; only worth it once DynamoDB holds accounts data anyway.

### Summary table

| | A. CW Logs + Insights | B. DynamoDB | C. Firehose + S3 + Athena |
|---|---|---|---|
| $/mo @10 | 0 | ~0.07 | ~0.02 |
| $/mo @100 | 0 | ~0.70 | ~0.2 |
| $/mo @1,000 (worst) | ~3-4 | ~7+ | ~2 |
| Free tier helps | yes (5 GB) | storage only | no |
| Infra to build | none | table + TTL + scripts | Firehose, S3, Glue, Athena |
| Write cost in Lambda | none | 1 API call | 1 API call |
| Time-range counts | good | poor | best |
| Saved queries | native, CDK | scripts | named queries |
| Accounts/rankings | raw telemetry only | best fit (own design) | analytics/backfill |

## Recommendation

1. **Phase now (collect only): CloudWatch Logs, JSON lines, 90-day retention (raise to 400 days if volume stays <=100 concurrent), Insights saved queries defined in CDK.**
2. **Schema is the contract, not the store.** Every record carries `v` (schema version), `matchId`, anonymous `pid`. This makes later replay into S3/Athena or DynamoDB mechanical.
3. **Upgrade trigger:** monthly ingest > ~4 GB (sum of all app logs), or need for retention > 1 year, or ad hoc SQL joins -> add subscription filter to Firehose -> S3 (+Athena). No app code change.
4. **Accounts/rankings effort** designs its own DynamoDB tables (players, per-player stats, leaderboards) written by the Match-end Lambda alongside the log line. Don't back-derive from logs.
5. **Kill switch:** env var `METRICS_SAMPLE_RATE` (0-1) so metrics volume can be cut at runtime. At 1,000 concurrent other costs (Lambda, API) will likely break the $5 cap before metrics do; metrics are not the long pole.

### How Lambdas write (batching)

- One `console.log(JSON.stringify(record))` per event; no batching, no SDK. Lambda's log agent buffers.
- One summary per Match, not per event: accumulate stats in Match state (server relays events anyway), emit once at Match end. If the server has no Match-level state and each client reports its own stats, emit one line per player report with the same `matchId` (2 lines/Match, ~0.6 KB each; same volume) and count `count_distinct(matchId)`.
- Keep a line <= ~1.2 KB: cap `hard` at 5 words, short field names only where cheap, ISO timestamps only once (`@timestamp` already exists in CloudWatch; omit `ts`).
- Peak online: scheduled Lambda every 5 min (EventBridge Scheduler, free tier covers it) logs `{t:"online"}`; or emit as an EMF metric with Max statistic.

## Schema sketch

All records are single-line JSON. `t` = record type. `@timestamp` comes from CloudWatch (no `ts` field). Language = `en|es`.

```jsonc
// t:"match"  - one per Match, written at Match end
{
  "t": "match", "v": 1,
  "matchId": "01JBX...",          // ULID
  "kind": "public",               // public | private
  "lang": "en",
  "end": "lives_out",             // lives_out | disconnect | peace
  "durMs": 118000,                // Match length (post-Countdown)
  "winner": 0,                    // index into players, null for peace
  "rematchOf": null,              // previous matchId when started via Rematch
  "players": [
    {
      "pid": "a1b2...",           // anonymous browser id
      "ret": true,                // client had stored id before this session (returning)
      "pace": 41.2,               // words/min (Pace)
      "words": 37, "wrong": 3,    // words typed, wrong submits (accuracy = 1 - wrong/(words+wrong))
      "shots": 12, "hit": 5, "def": 7,   // Shots fired / hit / defended
      "bDestroyed": 18, "bArrived": 4,   // Word bullets destroyed vs arrived
      "lives": 0,                 // Lives left
      "waitMs": 8400,             // Matchmaking wait (public only)
      "rttMs": 62,                // median network round-trip
      "howtoSkipped": false,
      "rematch": "accepted",      // none | proposed | accepted | declined
      "cc": "CO", "br": "chrome", "os": "mac"   // country + browser family + OS family only
    },
    { /* player 1, same fields */ }
  ],
  "hard": [ { "w": "rhythm", "miss": 3, "ms": 2400 } ]   // top-5 hardest words, both players merged (miss count, mean ms)
}

// t:"practice" - one per Practice run (client reports; Lambda needs an endpoint, consider sampling)
{ "t":"practice","v":1,"pid":"...","ret":true,"lang":"es","durMs":95000,"words":52,"wrong":4,"pace":33.8,"cc":"MX","br":"firefox","os":"win","hard":[{"w":"ñandú","miss":2,"ms":3100}] }

// t:"mm" - only Matchmaking given-up (matched waits live in match.players[].waitMs)
{ "t":"mm","v":1,"pid":"...","lang":"en","outcome":"gave_up","waitMs":31000,"cc":"US" }

// t:"online" - peak sample, every 5 min
{ "t":"online","v":1,"n":14,"en":9,"es":5 }
```

Notes:
- **Practice** is entirely in the browser per the map; capturing it requires an HTTP endpoint (API Gateway + Lambda invocation per run). Cheap, but add rate limiting and optional client-side sampling.
- **Privacy:** no IP, no full UA, no free text. `pid` is a random UUID; in the EU a persistent random id may still count as personal data, so (a) document it, (b) optionally store `pid = HMAC(server secret, browserId)[:16]`, recomputable at account-link time. Country only, not region/city. Retention bounded by the log group setting, which also gives a clean "delete after N days" story.
- **Rough country:** `CloudFront-Viewer-Country` is only available at the origin if the request goes **through CloudFront** with an origin request policy that forwards it (managed `AllViewerAndCloudFrontHeaders-2022-06`) ([CloudFront docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html)). If the WebSocket/HTTP API is called directly (API Gateway default URL), there is no country header. Depends on the transport ticket; options: front the API with the same CloudFront distribution, or have a CloudFront Function on the static site expose the country to the client (CloudFront Functions access to this header not verified here). Otherwise drop `cc`.
- **Returning players:** Insights has no joins and a per-day `count_distinct(pid)` only counts within the query window; hence `ret` is stamped client-side. True cross-period retention needs the S3/Athena upgrade or accounts.
- Alternative for hardest words if arrays prove awkward: emit one `t:"word"` line per hard word (more lines, simpler queries).

## 5 example saved queries (CloudWatch Logs Insights)

Untested drafts. Adjust field paths (`message.` prefix) to the real Lambda log format. Select the metrics log group and time range in the console; scan cost per run <= ~$0.17 at 1,000 concurrent.

**1. Matches and Practice runs per day by type** (switch `1d` to `1w` for weekly)
```
filter t = "match" or t = "practice"
| fields coalesce(kind, "practice") as mode
| stats count(*) as runs by bin(1d) as day, mode
| sort day desc
```

**2. Average Pace by language** (per player; use `1w` bin to see trend)
```
filter t = "match"
| fields jsonParse(@message) as m
| unnest m.players into p
| stats avg(p.pace) as avgPace, pct(p.pace, 50) as medianPace, count(*) as playerMatches by lang
```
(Add `or t = "practice"` and `pace` directly to include Practice.)

**3. Hardest words (top 25 by misses)**
```
filter t = "match" or t = "practice"
| fields jsonParse(@message) as m
| unnest m.hard into h
| stats sum(h.miss) as misses, avg(h.ms) as avgMs, count(*) as appearances by h.w as word, lang
| sort misses desc
| limit 25
```

**4. How Matches end, by kind, per week (+ average length)**
```
filter t = "match"
| stats count(*) as matches, avg(durMs)/1000 as avgSec by bin(1w) as week, kind, end
| sort week desc
```

**5. Matchmaking: gave-up count and wait times by language per day**
```
filter t = "mm" and outcome = "gave_up"
| stats count(*) as gaveUp, pct(waitMs, 50) as p50WaitMs, pct(waitMs, 90) as p90WaitMs by bin(1d) as day, lang
| sort day desc
```
(Matched waits, for comparison: `filter t="match" and kind="public" | fields jsonParse(@message) as m | unnest m.players into p | stats pct(p.waitMs,50) as p50, pct(p.waitMs,90) as p90 by bin(1d), lang`.)

Bonus, peak players online per day:
```
filter t = "online"
| stats max(n) as peak, max(en) as peakEn, max(es) as peakEs by bin(1d) as day
| sort day desc
```

Define them in CDK as `logs.CfnQueryDefinition` (name, `queryString`, `logGroupNames`) so saved queries ship with the stack.

## Open points / not verified

- Official CloudWatch Logs and Athena rate tables did not render in the fetch; $0.50/GB ingest, $0.03 storage, $0.005/GB scan, $5/TB come from AWS pricing examples, the Logs Insights launch post and secondary sources. Re-check with the AWS Pricing Calculator before committing.
- Whether Free Plan allows Firehose/Athena; exact always-free list per service.
- Lambda JSON log format interplay with `console.log(object)` and Insights field names.
- Whether Logs Insights `unnest` handles nested arrays inside `players` exactly as drafted.
- Traffic model is a worst-case guess; real Matches/hour are unknown until launch.
- Effect of credits on the $1/$3/$5 budget alerts.

## Sources

- [AWS Free Tier update blog (July 2025)](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits/)
- [AWS Free Tier page](https://aws.amazon.com/free/)
- [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [Logs Insights launch post](https://aws.amazon.com/blogs/aws/new-amazon-cloudwatch-logs-insights-fast-interactive-log-analytics/)
- [Logs Insights `unnest`](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax-Unnest.html)
- [Firehose pricing](https://aws.amazon.com/kinesis/data-firehose/pricing/)
- [Athena pricing](https://aws.amazon.com/athena/pricing/)
- [CloudFront headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html)
- [Timestream for LiveAnalytics availability change](https://docs.aws.amazon.com/timestream/latest/developerguide/AmazonTimestreamForLiveAnalytics-availability-change.html)
