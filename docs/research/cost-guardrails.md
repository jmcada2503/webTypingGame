# Research: AWS cost guardrails, free tier and traffic cost (#40)

Researched 2026-10-28. Region `us-east-1`. Prices are public list prices from the AWS pages cited in Sources; items I could not confirm on a primary page are marked **[unverified]**. Transport research (#39) was not on the remote when this was written, so both a WebSocket-via-AWS and a P2P-with-Lambda-signaling architecture are modeled.

## TL;DR

1. **No AWS hard cap exists.** Budgets lags 8-12 h per refresh (up to 3 refreshes/day) plus billing delay. Budgets alone can overshoot by a day of worst-case spend. Fix: our own near-real-time breaker on CloudWatch metrics, plus throttles that bound the $/hour ceiling, plus Budgets/billing alarm as a second, independent line.
2. **Worst-case overage = (max $/hour allowed by throttles) x (time to detect + kill).** With throttles below and the 5-min breaker working: ~$0.5-1 over the cap. If the breaker is dead and only Budgets fires: ~$60-100 (WebSocket) or ~$25-35 (P2P with throttled WS fallback). P2P is also the safer design.
3. **$5/month is a volume budget, not a traffic tier.** Gross cost per Match (all-in, list price): WebSocket relay ~$0.0005-0.0008; P2P with 20% WebSocket fallback ~$0.00015-0.0002; pure P2P ~$0.00007. So $5 buys roughly 6k-10k Matches (WS), 23k-33k (P2P+fallback), 72k (pure P2P). 1,000 concurrent is not affordable on any design for more than a few hours per month; "servers resting" WILL trigger in the success case.
4. **Free tier is mostly gone for API Gateway.** The 12-month free tiers ended for every legacy account by 2026-07-15 (12 months after the 2025-07-15 cutoff); new accounts get $100-200 credits (12-month validity) instead. Always-free: Lambda, DynamoDB (provisioned 25/25 + 25 GB), CloudFront pay-as-you-go (1 TB + 10M req), CloudWatch (10 alarms), Budgets (2 action budgets). API Gateway, S3 storage are NOT free after the first year.
5. **Account plan trap:** the new Free plan *cannot* be charged (a real hard cap) but the account **closes after 6 months or when credits run out**. Use it during development; upgrade to the Paid plan before launch. After upgrade there is no hard stop, only our guardrails.
6. **Cheapest abuse floor:** Shield Standard (free, automatic) + CloudFront in front + Lambda Function URLs behind CloudFront OAC + per-function reserved concurrency (also acts as the rate limit and the kill switch) + DynamoDB provisioned at the free 25/25 (a hard $0 ceiling). AWS WAF pay-as-you-go costs >= $6/month, over the cap by itself. The CloudFront *Free flat-rate plan* bundles WAF + IP rate limiting at $0, but is blocked for "Free Tier accounts" (see Uncertainties).

---

## 1. Free tier, plans and what expires

### 1.1 Account plans (accounts created on/after 2025-07-15)

- Free plan: $100 credits on sign-up, up to $100 more for activities. **Ends 6 months after opening or when credits run out, whichever first; the account then closes**, data is kept 90 days, and you can upgrade to Paid within those 90 days to keep it. "Free account plans ensure you won't incur any charges." Only "select services" are available; services that could drain credits are excluded. Credits expire 12 months after opening.
- Paid plan: all services, pay-as-you-go beyond credits, same $100-200 credits (valid 12 months), always-free offers continue. No hard stop.
- Legacy accounts (created before 2025-07-15) keep the old model: 12-month free tier + always-free. All 12-month offers have therefore **expired as of today (2026-10-28)**; only always-free remains and there are no credits.
- Free-plan accounts auto-upgrade to Paid if they join AWS Organizations / Control Tower. Do not create the game account inside an Organization if the Free plan hard stop is wanted during development.

Sources: [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [AWS Free Tier](https://aws.amazon.com/free/), [Free Tier terms](https://aws.amazon.com/free/terms/).

### 1.2 Per-service status for this project

| Service | What is free | Status after plan/credits | Notes |
|---|---|---|---|
| Lambda | 1M req + 400k GB-s / month | Always free (price page does not say "always"; widely documented as non-expiring; **[unverified on primary page]**) | $0.20/M req, $0.0000166667/GB-s |
| DynamoDB | 25 GB storage, 25 WCU + 25 RCU **provisioned**, 2.5M stream reads | Always free | **On-demand has no free request units.** Provisioned+Standard class only. On-demand $0.625/M write, $0.125/M read |
| API Gateway (HTTP/WS/REST) | 1M calls, 1M WS msgs, 750k conn-min | **12 months only**; gone for legacy accounts; new accounts pay from credits | HTTP $1.00/M; WS msg $1.00/M (32 KB units; ping/pong control frames free), $0.25/M conn-min |
| CloudFront (pay-as-you-go) | 1 TB out, 10M HTTP(S) req, 2M CF Functions invocations / month | Always free | Beyond: $0.085/GB (first 10 TB), $0.0100 per 10k HTTPS req; WebSocket data has no extra CF charge; client-to-origin $0.02/GB |
| CloudFront flat-rate plans | Free $0: 1M req, 100 GB, WAF (5 rules), IP rate limiting, DDoS | "No overage charges"; allowance is soft (see 3.4) | Pro $15, Business $200, Premium $1,000. **Not available to "Free Tier accounts"** |
| S3 | 5 GB (was 12-month) | Gone | $0.023/GB-mo **[unverified, list price]**; site is < 100 MB, so cents |
| CloudWatch | 10 custom metrics, 10 alarms, 5 GB logs, 3 dashboards, 1M API req | Free-tier listing (page does not say "always") | Logs ingest ~$0.50/GB, alarm $0.10/mo, custom metric $0.30/mo |
| Budgets | Budget + notifications free; first 2 action-enabled budgets free | Ongoing | Extra action budget $0.10/day |
| EventBridge Scheduler | 14M invocations / month | Free tier | $1.00/M beyond |
| SNS | 1M publishes **[unverified]** | | email/SQS targets cost ~0 |

Sources: [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/), [CloudFront pay-as-you-go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/), [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/), [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/).

### 1.3 Recommendation on plans

- **Development:** stay on the Free plan. It is the only true hard cap AWS offers. Track the 6-month clock (open date + 6 months).
- **Launch:** upgrade to Paid *before* the Free plan expires (and before launch, since a closed account takes the whole game down). Remaining credits carry over for their 12-month validity.
- The guardrails below treat credits as a bonus, not as the cap: budgets are set on **gross cost excluding credits** so the owner never owes more than ~$5 even after credits expire. (Budgets "advanced options" let credits be included or excluded; I could not confirm the default **[unverified]**, so set `IncludeCredit=false` explicitly in CDK `costTypes`.)

---

## 2. Cost model

### 2.1 Unit prices used (us-east-1, list)

WS message $1.00/M (32 KB metering) | WS connection-minute $0.25/M | HTTP API $1.00/M | Lambda $0.20/M + $0.0000166667/GB-s | DynamoDB on-demand $0.625/M write, $0.125/M read | CloudFront HTTPS $1.00/M beyond 10M free | Lambda logs to CloudWatch ~$0.50/GB.

### 2.2 Workload assumptions (all tunable; these dominate the answer)

- Match cycle 3.2 min: how-to + matchmaking + countdown + end screen ~1.1 min, **in-match 2.1 min** (65.6% of the cycle). Players play back-to-back (18.75 matches per player-hour; this is a stress assumption, real players idle more, which lowers WS cost and P2P signaling cost).
- Relayed game events: **0.7 per player per second** (Shot fired, Word bullet destroyed/arrived, Life lost; keystrokes are never sent).
- App heartbeat for the 5 s disconnect grace: **0.5 per player per second**, relayed to the opponent (WS "base" case). "Lean" case: no app heartbeat (rely on `$disconnect` + event gaps) and the client holds the opponent's connection id, so no DynamoDB lookup.
- WS billing: every inbound message and every outbound `PostToConnection` push is one billed message; each inbound message is one Lambda invocation (256 MB, 30 ms).
- P2P: ~40 signaling/matchmaking HTTP requests per Match (queue join, polling, offer/answer/ICE, summary), each ~$1.7/M all-in (HTTPS front $1.00 + Lambda $0.30 + DynamoDB mix $0.37). Relay of game events over the WebRTC DataChannel is free. **20% of Matches fall back to WS relay** (sources put TURN-needed connections at roughly 15-25%, from vendor blogs, not authoritative). No TURN: STUN is free ([Cloudflare](https://developers.cloudflare.com/realtime/turn/faq/) STUN is "free and unlimited"; TURN there is 1,000 GB free then $0.05/GB if ever wanted).
- Lobby: every open tab sends 1 HTTP heartbeat/min (online count) = ~$0.0001 per tab-hour.
- Not in the numbers: Lambda log ingestion (~$0.17 per M invocations, +3-5%), S3/CloudFront static (a 1.5 MB visit costs $0 inside the 1 TB free tier; 1 TB = ~700k visits/month).

### 2.3 Unit costs

| | In-match player-hour | Per Match (all-in) | Matches per $5 |
|---|---|---|---|
| WS relay, base | $0.0103 (8,640 msgs, 4,320 invocations) | $0.00079 | ~6,300 |
| WS relay, lean | $0.0059 (5,040 msgs, 2,520 invocations) | $0.00048 | ~10,400 |
| P2P + 20% WS fallback (base fallback) | | $0.00021 | ~23,400 |
| P2P + 20% WS fallback (lean fallback) | | $0.00015 | ~33,000 |
| P2P pure (no fallback) | | $0.000069 | ~72,000 |

WS cost is ~84% the message price ($1/M); connection-minutes ($0.25/M) are negligible, Lambda ~14%.

### 2.4 Monthly cost at 10 / 100 / 1,000 concurrent players

"Peak" = N concurrent for 3 h/day (90 h/month). "24x7" = N all month (720 h). Gross list price including lobby heartbeats; subtract at most ~$11/month for always-free offsets (CloudFront 10M requests, Lambda 1M/400k, DynamoDB if provisioned) and ignore credits.

| Architecture | N | $/hour at N | Peak 3 h/day | 24x7 | Hours of N that $5 buys |
|---|---|---|---|---|---|
| WS base | 10 | 0.075 | $7 | $54 | 67 |
| | 100 | 0.75 | $68 | $541 | 6.7 |
| | 1,000 | 7.52 | $677 | $5,413 | 0.7 |
| WS lean | 10 | 0.046 | $4 | $33 | 109 |
| | 100 | 0.46 | $41 | $331 | 11 |
| | 1,000 | 4.59 | $413 | $3,308 | 1.1 |
| P2P + 20% fallback (base) | 10 | 0.021 | $2 | $15 | 237 |
| | 100 | 0.21 | $19 | $152 | 24 |
| | 1,000 | 2.11 | $190 | $1,517 | 2.4 |
| P2P + 20% fallback (lean) | 10 | 0.015 | $1 | $11 | 329 |
| | 100 | 0.15 | $14 | $110 | 33 |
| | 1,000 | 1.52 | $137 | $1,096 | 3.3 |
| P2P pure | 10 | 0.008 | $1 | $5 | 666 |
| | 100 | 0.075 | $7 | $54 | 67 |
| | 1,000 | 0.75 | $68 | $541 | 6.7 |

Reading it:
- 10 concurrent at peak: ~$1-7 gross. P2P fits in the always-free offsets (net ~$0); WS needs the lean tweaks and credits.
- 100 concurrent: only P2P (pure or with lean fallback) gets near the cap, and only for ~30-65 h/month. Cap trips in a day or two of sustained 100.
- 1,000 concurrent: $140-680 per 3 h/day month on any design; "know the cost" = ~$1.5-7.5 per hour of 1,000-player traffic. A viral hour costs more than the monthly cap.
- Model sensitivity: WS cost scales linearly with relayed events/s and heartbeat; halving back-to-back play (more menu time) roughly halves the WS in-match part and the P2P signaling part. Levers ranked by payoff: (1) P2P default; (2) drop the relayed app heartbeat (-43% of WS); (3) client-held opponent id, no DDB read (-3%); (4) coalesce events into 10 Hz ticks (messages are 32 KB-metered, so batching is free); (5) sampled presence for the online count (tabs report with probability p = min(1, 100/online) and the server scales by 1/p; bounds lobby cost at about 100 tabs); (6) WS only during a Match; (7) log level `ERROR`, 3-day retention, no API Gateway access logs.

Architecture-neutral items that must NOT be added (fixed monthly cost over the cap): NAT Gateway (~$32), ALB (~$16), WAF pay-as-you-go ($5 web ACL + $1/rule + $0.60/M req), Secrets Manager, KMS CMKs, provisioned concurrency, Route 53 hosted zone, X-Ray.

---

## 3. Guardrail design

### 3.1 Layers and what bounds what

```
 L0 prevention   free-tier-shaped config (provisioned DDB, reserved concurrency, no fixed-cost services)
 L1 throttles    set the maximum $/hour the stack can burn (R_max)
 L2 breaker      our estimator on CloudWatch metrics, every 5 min active (30 min idle): trips at est. $4
 L3 Budgets      $1 / $3 / $5 actual (+ forecast), SNS -> email + killer Lambda; backup Budget action
 L4 billing alarm CloudWatch EstimatedCharges $1/$3/$5 (6 h period, us-east-1), same SNS topic
 L5 human        GitHub Actions workflow_dispatch "rest" / "wake"
```

Worst-case overage = R_max x (detection delay + kill time).

### 3.2 Alerts and responses

| Trigger | Action |
|---|---|
| Budgets actual >= $1 (20%) | Email only |
| Budgets actual >= $3 (60%) or breaker est. >= $2.5 | Email + **degraded** mode: new Match admission capped at half of normal, throttles halved (stage/route settings), matchmaking says "busy" past the cap |
| breaker est. >= $4 | **Resting** (kill) automatically; margin of $1 absorbs billing lag and unmodeled costs |
| Budgets actual >= $5 (100%) or EstimatedCharges >= $5 | **Resting** (idempotent, same killer) + Budgets action as backup |
| Budgets forecast >= 100% | Email only (forecast needs history; not a control) |

Budgets facts: data refresh up to three times a day, typically 8-12 h apart; "there can be a delay between when you incur a charge and when you receive a notification"; actions are limited to applying an IAM policy / SCP, or stopping EC2/RDS instances ([budget actions](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/budgets-controls.html), [managing costs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/budgets-managing-costs.html)). **Budgets cannot touch Lambda concurrency or API Gateway itself**, so the real kill is an SNS-triggered Lambda we write. The native Budget action (apply a deny-all IAM policy to the game Lambda execution role) is a free backup: handlers then fail fast, though API Gateway messages stay billed, so it is not sufficient alone. Free budgets: 2 action-enabled budgets, so use 1 for the $5 action and keep 1 spare. Billing alarm: `EstimatedCharges` is "sent several times daily", only in us-east-1 (matches our region), needs "Receive CloudWatch Billing Alerts" enabled ([doc](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html)). Uses 3 of 10 free alarms.

### 3.3 L1 throttles (provisional values for the build tickets; they define R_max)

| Surface | Control | Value (sized for ~100 concurrent) |
|---|---|---|
| HTTP signaling/matchmaking | Lambda Function URL behind CloudFront OAC; per-function **reserved concurrency** (max RPS = 10 x reserved concurrency; excess returns 429) | e.g. 8 -> 80 rps |
| WebSocket `$connect` | stage/route throttle | 5/s, burst 20 |
| WebSocket message routes | stage/route throttle | 200/s |
| DynamoDB | **provisioned 25 WCU / 25 RCU, autoscaling off, TTL on all items** | stays inside free tier; beyond it requests throttle instead of costing money (on-demand would be uncapped). At 1,000-concurrent WS, reads need ~600 RCU: switch to client-held opponent id or accept on-demand |
| Lambda total | reserved concurrency sum (e.g. 50) | bounds compute |
| Per anonymous id | counters in DynamoDB (matches/hour, invites/hour) | stops one browser burning quota |

Notes: API Gateway account throttle default 10,000 rps (burst 5,000), WebSocket 500 new connections/s per account, 2 h max connection, 10 min idle, 128 KB message / 32 KB frame ([limits](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html), [WS quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)). New accounts have **reduced Lambda concurrency quotas, raised automatically by usage** ([Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)); a Match-heavy second at 1,000 players needs ~25 concurrent executions, so check Service Quotas early (and mind the "100 unreserved" rule when reserving).

**R_max** (all throttles saturated by an attacker):
- WS architecture: 200 inbound/s -> 400 billed msgs/s = $1.44/h; Lambda $0.23/h; `$connect` 5/s held 2 h = 36k connections = $0.54/h conn-min; HTTP 80 rps x $1.7/M ~ $0.5/h; DynamoDB $0 (provisioned). **R_max ~ $2.5-3/h ~ $65/day.**
- P2P architecture: HTTP ~$0.5/h, plus the WS fallback endpoint (which an attacker can hit directly) throttled to ~20% of the WS-architecture values (40 msgs/s, 1 connect/s: ~$0.45/h). **R_max ~ $1/h ~ $23/day.** Pure P2P with no WS endpoint: ~$0.5/h.

### 3.4 Overage bounds

| Failure scenario | WS arch | P2P arch |
|---|---|---|
| L2 works (5-min poll + ~1 min kill, trip at est. $4) | ~$0.25 (R_max x ~6 min) on top of $4 -> ends ~$4.3 | ~$0.1 -> ~$4.1 |
| L2 down, L3 works (Budgets refresh 8-12 h + billing lag up to ~24 h) | R_max x 24-36 h = **$60-100** | **$25-35** |
| L2 and L3 both down | unbounded in time, bounded in rate: ~$65/day (WS), ~$23/day (P2P with WS fallback); email alerts at $1/$3/$5 still arrive on the same lag | |

Tighten by lowering throttles (bound scales linearly), by degraded-mode halving at $2.5-3, or by moving heavy relay off AWS. Note throttled 429 requests: I could not find an official statement on whether API Gateway bills them, so assume they are billed **[unverified]**. Lambda reserved-concurrency throttles on Function URLs return 429 before any invocation is billed.

### 3.5 L2 breaker (near-real-time estimator)

- EventBridge Scheduler (14M free invocations/mo) -> `guard` Lambda every 5 min while active (every 30 min when the last window was idle).
- Reads CloudWatch metrics (1-min granularity, near real time): API Gateway `MessageCount`, `ConnectCount`, `Count`; Lambda `Invocations`, `Duration` (x memory); then `est$ = msgs x 1e-6 + connMin x 0.25e-6 + http x 1.0e-6 + invocations x 0.2e-6 + GB-s x 1.66667e-5 + 0.4 x DDB ops...`. Keeps a month tally in DynamoDB (`spend#YYYY-MM`). Counts gross, free tiers ignored, so it trips early rather than late.
- Cost: `GetMetricData` ~$0.01 per 1,000 metrics requested **[unverified]**: ~6 metrics x 8.6k polls = ~$0.5/month worst case, ~$0.1-0.2 with the idle back-off.
- Cheap complement at $0: 4 CloudWatch alarms (inside the 10 free) on 5-min sums (WS `MessageCount`, `ConnectCount`, Lambda `Invocations`, Lambda `Throttles`) that fire when throttles are saturated for 2 periods -> same SNS -> degrade/kill. These bound *rate* anomalies; the tally bounds *cumulative* spend.
- The `guard`/killer Lambda has its own tiny reserved concurrency and is excluded from the kill so it can always run and later revive.

### 3.6 Kill switch ("servers resting") and flag

State lives in one place: DynamoDB item `config#mode` = `open | degraded | resting` (handlers cache it in memory ~10-30 s; no extra cost) and a static **`/status.json`** in the site bucket: `{"state":"resting","reason":"budget","since":"..."}`.

Killer (SNS-triggered, idempotent, order matters):
1. Write `/status.json` (S3 PUT, `Cache-Control: max-age=30`; the Free flat-rate plan allows only default caching rules, so rely on the origin header). Optionally invalidate `/status.json` (first 1,000 invalidation paths/month are free **[unverified]**).
2. Set `PutFunctionConcurrency = 0` on every backend Lambda. For Function URLs this "deactivates" them: "throttles all requests ... HTTP 429" ([doc](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html)).
3. Stop the API Gateway WebSocket from billing: set route throttles to 0, or if 0 is not accepted **[unverified]**, delete the stage (immediate; revive redeploys via CDK `workflow_dispatch`). Lambda concurrency 0 alone does NOT stop WS message billing, because API Gateway still counts inbound messages. Existing connections: best-effort `DeleteConnection`; otherwise they die within 10 min idle / 2 h max (connection-minutes are trivial: 1,000 held 2 h = $0.03).
4. Set `config#mode=resting`; fire an SNS email.

Client behavior: online modes read `/status.json` on menu load and every ~30 s together with the online count; `resting` -> screen with budget-cap message + GitHub Sponsors link. **Fail-safe default:** if the status fetch or any API call fails 2 times in a row, show the same screen. **Practice never touches AWS beyond the static bundle**, so it stays fully playable (CloudFront/S3 are not part of the kill and cost ~$0 inside the 1 TB / 10M free tier).

Revive: (a) manual `workflow_dispatch` "wake" (also the manual "rest" button); (b) automatic on the 1st of the month 00:00 UTC via EventBridge cron, since Budgets resets monthly, after resetting the DDB tally. Keep (b) behind a flag until the first month has been observed.

### 3.7 Abuse / DDoS floor (cheapest first)

| Layer | Cost | What it gives |
|---|---|---|
| Shield Standard | $0, automatic | L3/L4 DDoS protection for all customers, strongest on CloudFront ([doc](https://docs.aws.amazon.com/waf/latest/developerguide/ddos-standard-summary.html)) |
| CloudFront as only front door; Function URLs locked with OAC (SigV4, direct hits return 403) | $0 (OAC for Lambda URLs has no extra fee, [announcement](https://aws.amazon.com/about-aws/whats-new/2024/04/amazon-cloudfront-oac-lambda-function-url-origins/)) | Hides origin; a bypassing attacker cannot reach Lambda. For the HTTP path only. Note POST bodies must carry `x-amz-content-sha256` ([blog](https://aws.amazon.com/blogs/networking-and-content-delivery/secure-your-lambda-function-urls-using-amazon-cloudfront-origin-access-control/)) |
| Reserved concurrency + route throttles + provisioned DDB | $0 | Bounds R_max; a flood causes 429s (availability loss) not an invoice |
| CloudFront **Free flat-rate plan**: WAF (5 rules), IP-based rate limit, "no overage charges", blocked requests excluded from usage | $0 | Per-IP rate limiting. Requirement caveat: "Free Tier accounts cannot use CloudFront Flat-Rate Plans" ([PPM docs](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html)); likely means Free-plan accounts, so usable after upgrading to Paid **[unverified]**. Allowance 1M req/100 GB is soft: first spike up to 3x is free of impact, sustained excess "may be adjusted" ([doc](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)). Cannot combine with the 10M-request pay-as-you-go free tier. Sensible only if monthly requests stay near/below 1M (roughly <= 10-30 concurrent); at 100 concurrent P2P, signaling alone is ~3-4M req/month, so use pay-as-you-go there |
| AWS WAF pay-as-you-go | >= $6/month ($5 ACL + $1 rule) + $0.60/M | **Rejected**: exceeds the cap on its own |

API Gateway WebSocket endpoints cannot be OAC-locked, so a direct `execute-api` hit bypasses CloudFront; the throttles above plus the breaker are the real WS protection. A reason in itself to prefer P2P as the default path. Residual risk accepted: a determined flood exhausts throttles and makes the game unavailable until it rests; that is the designed degradation.

---

## 4. Decisions to carry into build tickets

1. Account: new dedicated account; stay on the Free plan while building; upgrade to Paid before launch (calendar the 6-month date); do not join an Organization before then.
2. Default to P2P (WebRTC DataChannel) with Lambda/Function-URL signaling; WS relay only as fallback. Cost is ~3-9x lower per Match and R_max ~3x lower.
3. Budgets: monthly gross cost budget $5 (credits excluded), actual alerts $1/$3/$5, one action-enabled budget with the deny-IAM backup action, SNS to email + killer. CloudWatch EstimatedCharges alarms at the same three levels.
4. Build the `guard` breaker (trip at est. $4), degraded mode at $2.5-3, `/status.json` flag, killer + revive, all in the AWS skeleton ticket (#45 / #60 blockers), and unit-test the estimator against the unit prices above.
5. DynamoDB provisioned 25/25 with TTL; Lambda reserved concurrency per function; no fixed-cost services.
6. Metrics: one summary record per Match (already in the map) keeps writes to ~1 per Match.
7. Re-run this model once #39 fixes the real message schema; replace the 0.7 events/s and 0.5 heartbeat/s guesses with a measured Match.

## 5. Open uncertainties

- Which account the owner has: new (Free/Paid plan, credits) or legacy (no credits, free tiers expired). Changes whether a hard stop exists during development.
- CloudFront flat-rate Free plan eligibility ("Free Tier accounts cannot use") and whether Free-plan accounts can use WAF / pay-as-you-go CloudFront at all ("select services").
- Whether API Gateway bills throttled (429) requests; whether WS route throttle accepts 0; what stage deletion does to live WS connections.
- Current Lambda concurrency quota of the new account (reduced for new accounts; automatically raised) and its interaction with reserved concurrency.
- Budgets default for credits in cost types (set explicitly), actual refresh cadence in practice (8-12 h documented), and EstimatedCharges latency in practice.
- Primary-page confirmation that Lambda/CloudWatch/SNS free tiers are "always" (inferred from secondary sources); `GetMetricData` price; free invalidation count.
- Workload numbers (0.7 events/s, 0.5 heartbeat/s, 20% fallback, back-to-back play) are assumptions and drive the answer 2x either way; the 20% TURN-needed figure comes from non-authoritative vendor blogs.

## Sources

- AWS plans: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html , https://aws.amazon.com/free/ , https://aws.amazon.com/free/terms/
- API Gateway: https://aws.amazon.com/api-gateway/pricing/ , https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html , https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html , https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html
- Lambda: https://aws.amazon.com/lambda/pricing/ , https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html , https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html
- DynamoDB: https://aws.amazon.com/dynamodb/pricing/on-demand/
- CloudFront: https://aws.amazon.com/cloudfront/pricing/ , https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/ , https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html , https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html , https://aws.amazon.com/about-aws/whats-new/2024/04/amazon-cloudfront-oac-lambda-function-url-origins/ , https://aws.amazon.com/blogs/networking-and-content-delivery/secure-your-lambda-function-urls-using-amazon-cloudfront-origin-access-control/
- Budgets/billing: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/budgets-controls.html , https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/budgets-managing-costs.html , https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/ , https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html
- Other: https://aws.amazon.com/cloudwatch/pricing/ , https://aws.amazon.com/eventbridge/pricing/ , https://aws.amazon.com/waf/pricing/ , https://docs.aws.amazon.com/waf/latest/developerguide/ddos-standard-summary.html , https://developers.cloudflare.com/realtime/turn/faq/
