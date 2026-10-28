# Research: Real-time transport (WebSocket vs WebRTC vs mix)

Ticket: #39 (map #38). Researched 2026-10-28. Prices are us-east-1 list prices read from AWS pages on that date. Nothing here was measured on a live system: no AWS resources were created. Every number marked **(est.)** is an estimate or an assumption, not a measurement.

## TL;DR

- **Recommendation: (c) P2P WebRTC DataChannel when it works, WebSocket relay through AWS as fallback.** Build in two steps: ship (a) first, because the WebSocket API is needed for Matchmaking/signaling anyway and doubles as the fallback; then add WebRTC P2P as an upgrade behind the same `send(event)` interface.
- **Why not (a) alone:** relay cost is about $0.00063 per Match (base case), which fits ~7,900 Matches/month under the $5 cap and breaks at 100 concurrent players. Every message also detours through us-east-1, which is the worst for Spain and southern Latin America.
- **Why not (b) alone:** realistic 15-30% of pairs cannot connect directly. Without a relay those players cannot play. TURN would cover most, but it adds a third-party dependency, while the WebSocket fallback already exists and covers blocked-UDP and WebRTC-disabled browsers too.
- **TURN is optional.** At launch use STUN only (free). If measured fallback rate is high, Cloudflare Realtime TURN has a 1,000 GB/month free tier; a Match uses about 31 KB of relay traffic (est.), so about 32 million Matches fit in the free tier.
- **API Gateway WebSocket has no permanent free tier.** Only the legacy 12-month offer (1M messages + 750k connection minutes/month) or, for new accounts, $100-$200 credits with a free plan that closes the account after 6 months.

## Constraints from the map (relevant ones)

Serverless on AWS in `us-east-1`, ~$0 at low/middle traffic, hard ~$5/month cap, design for ~10 concurrent, ensure ~100 works, know the cost at 1,000. Events only (no keystrokes). Defender's client judges its own defense locally; server relays events. Attack words are server-picked, different sequence per player. Disconnect = 5 s grace, then the other player wins. Countdown starts once both connections are confirmed. Anonymous ids, no accounts.

## 1. Messages per Match

Assumptions (all est., revisit with real play data): Match lasts 120 s (range 60-300 s); each player fires one Shot every ~4 s (30 Shots); about 1 in 6 Shots arrives and costs a Life; Pace update and heartbeat are merged into one message every 2 s per player (the 5 s grace period needs a heartbeat well under 5 s, and a missed pair = ~4 s).

Per player, upstream (client to server or peer):

| Event | Count |
|---|---|
| Shot fired | 30 |
| Word bullet destroyed / arrived (defender reports) | 30 |
| Life lost | 5 |
| Idle state changes | 4 |
| Pace + heartbeat (every 2 s) | 60 |
| **Total** | **~129** |

Under a server relay every upstream message is billed twice: once inbound to API Gateway, once when the Lambda forwards it with `POST @connections` (the docs list `PostToConnection` as the way to push to a client). That gives:

| Scenario | Messages per Match (both players, in + forwarded) |
|---|---|
| Lean (heartbeat only when silent, ~half suppressed) | ~350 |
| **Base** | **~516** |
| Heavy (separate heartbeat 1/s and Pace 1/s, 40 Shots each) | ~1,100 |

Server-side Lambda invocations are the inbound half: ~175 / 258 / 548 per Match.

Matchmaking/signaling (needed in every option): connect, join queue, match found, SDP offer/answer, ~8 ICE candidates each, ready, final summary: ~14 inbound + ~14 forwarded per player, **~56 messages per Match**.

Payload sizes are a few dozen bytes, far below the 32 KB metering step, so every message counts as exactly one.

## 2. API Gateway WebSocket: pricing, free tier, limits

Pricing ([API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/)):
- $1.00 per million messages, metered in 32 KB increments; messages up to 128 KB. Ping/pong control frames are not metered (browsers cannot send ping frames from JS anyway, so the heartbeat has to be an app message and is billed).
- $0.25 per million connection minutes.
- Messages pushed by a backend through `@connections` count as messages (they are normal outbound messages). Data transfer out is billed separately but is negligible at ~100 B messages.

Free tier status:
- **Legacy 12-month Free Tier** (accounts created before 2025-07-15): 1M messages + 750,000 connection minutes per month, for 12 months only. Not always-free. 1M messages is ~1,900 Matches/month under (a) base.
- **New accounts (from 2025-07-15)**: choose a free plan (up to $200 credits: $100 at signup + up to $100 for activities; ends after 6 months or when credits run out; then the account **closes**, data kept 90 days, upgrade to paid to keep it) or a paid plan (same credits, pay beyond them). Sources: [AWS Free Tier page](https://aws.amazon.com/free/), [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).
- Which one applies to this account is **unknown** (open question). Either way, API Gateway is a paid service in steady state. Plan the $5 cap with no free-tier relief.
- Lambda: 1M requests + 400,000 GB-s per month free ([Lambda pricing](https://aws.amazon.com/lambda/pricing/); the page does not label it "always free", the Free Tier page says 30+ services have monthly free usage on both plans). DynamoDB: first 25 GB storage free ([DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)).

Limits ([API Gateway endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/apigateway.html), [WebSocket quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)):

| Limit | Value | Adjustable |
|---|---|---|
| Idle connection timeout | 600 s (10 min) | No |
| Max connection duration | 7,200 s (2 h) | No |
| Message payload | 128 KB (frame 32 KB) | No |
| New connections/s per account+region | 500 (burst 500) | Yes |
| Account throttle (all API types) | 10,000 RPS, burst 5,000 | Yes |
| Integration timeout | 29 s | Yes (regional) |
| Routes per API | 300 | Yes |

Fit: a Match is ~2 min and the idle timeout is 10 min, so neither limit bites if the client reconnects after a Match. At 1,000 concurrent players the relay does ~1,100 inbound + ~1,100 forwarded req/s (est., base), about a fifth of the 10,000 RPS account throttle, and ~44 concurrent Lambda executions (40 ms each, est.). New accounts have **reduced Lambda concurrency quotas** that AWS raises automatically with usage ([Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)); default is 1,000. Check the actual value in Service Quotas before launch.

## 3. Cost per Match

Lambda assumed 128 MB, 40 ms per relay invocation, $0.20 per million requests + $0.0000166667 per GB-s. DynamoDB on-demand $0.125 per million strongly-consistent reads (1 read per relayed message to look up the opponent's connection id) and $0.625 per million writes (12 writes per Match: connection/pair records). Connection minutes: 6 for (a) (2 players x ~3 min), 8 for signaling-only. The cost model is reproducible from the formulas above.

| Option | API GW | Lambda | DynamoDB | TURN | **Total / Match** |
|---|---|---|---|---|---|
| (a) WebSocket relay, lean | $0.00035 | $0.00005 | $0.00003 | - | **$0.00043** |
| (a) base | $0.00052 | $0.00007 | $0.00004 | - | **$0.00063** |
| (a) heavy | $0.00110 | $0.00016 | $0.00008 | - | **$0.00133** |
| (b) P2P, signaling only (no fallback) | $0.00006 | $0.000008 | $0.000011 | $0 (STUN) | **$0.000077** |
| (c) P2P + WS fallback, 10% fallback | | | | | **$0.00014** |
| (c) 20% fallback | | | | | **$0.00020** |
| (c) 30% fallback | | | | | **$0.00027** |

(c) = signaling cost for every Match + the (a) base relay cost for the fallback share. If TURN were used as fallback instead of the WS relay, the extra cost is ~31 KB per relayed Match (129 msgs x 2 players x ~120 B incl. UDP/DTLS/SCTP overhead, est.) = effectively $0 under the free tier.

### Cost at 10 / 100 / 1,000 concurrent players

Model: every player plays back-to-back Matches, cycle 3 min (2 min Match + ~1 min queue/Countdown/end screen), i.e. 10 Matches per hour per concurrent player (each Match has two players). This is a **heavy-use** assumption; real duty cycles will be lower. No free-tier relief. Excludes the cost of holding a WebSocket open in the menu and the 30 s online-count refresh (see below).

| Concurrent players | Matches / hour | (a) $/hour | (b) $/hour | (c) @20% $/hour |
|---|---|---|---|---|
| 10 | 100 | $0.063 | $0.0077 | $0.020 |
| 100 | 1,000 | $0.63 | $0.077 | $0.20 |
| 1,000 | 10,000 | $6.30 | $0.77 | $2.03 |

Hours per month the $5 cap lasts at that concurrency:

| Concurrent | (a) | (b) | (c) @20% |
|---|---|---|---|
| 10 | 79 h (~2.6 h/day) | 650 h | 246 h |
| 100 | 7.9 h | 65 h | 24.6 h |
| 1,000 | 0.8 h | 6.5 h | 2.5 h |

Same thing as Matches per month under $5: (a) ~7,900, (c) @20% ~24,600, (b) ~65,000.

Reading: at the design target (~10 concurrent, a few peak hours a day) (a) is inside the cap, (c) has ~3x headroom. At 100 concurrent sustained, no option stays under $5 except short peaks: the cap and the budget action would trip, which matches the map's "servers resting" design. At 1,000 concurrent the relay is $6.30/h, so P2P (or P2P with TURN, not WS) is the only way to make 1,000 affordable at all, and it would still be $0.77/h (~$560/month 24/7).

Cost lines outside the per-Match model (apply to all options, belong to the Matchmaking / online-count tickets):
- Open WebSocket in menu: 60 connection-min/hour/player x $0.25/M = $0.000015/player-hour. 1,000 players 24/7 = 43.8M min = ~$10.95/month. Cheap per player but not zero; prefer opening the socket only when entering Matchmaking.
- Online count refreshed every ~30 s per open tab = 120 requests/hour/player. As WebSocket messages that is $0.00012/player-hour, i.e. 2-8x the per-Match cost for a menu-heavy player. Serve it as a CloudFront-cached JSON instead (~$0).

## 4. Latency and jitter

No official AWS figure exists for the latency a WebSocket route + Lambda integration adds. What I found:
- Third-party blog estimate: 40-120 ms added by API Gateway WebSocket routes on top of network latency (anecdotal, unverified) - [Markaicode](https://www.markaicode.com/websocket-gold-price-lambda-optimization/). A REST example in an AWS re:Post thread attributes ~30 ms to API Gateway itself ([re:Post](https://www.repost.aws/ja/questions/QUDQRHyKfbQCCGUhezHpupqg/400-ms-difference-between-apig-latency-and-lambda-latency)).
- Lambda cold starts: "typically under 1% of invocations", "under 100 ms to over 1 second" ([Lambda docs](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)). With ~10 concurrent players and sparse traffic, cold starts will be more common than 1%, and each shows up as a latency spike (jitter).
- The relay path has two API Gateway legs plus Lambda plus a DynamoDB read plus an HTTPS `POST @connections` call. My estimate for the added one-way delay is 40-120 ms warm, 150-1,000+ ms on a cold start (**est.**, must be measured in a prototype).

Network RTT from the AWS region (inter-region RTT used as a proxy for the backbone part; real user last mile adds ~10-40 ms):

| Pair | RTT | Source |
|---|---|---|
| us-east-1 to ca-central-1 | 16 ms | [economize.cloud](https://www.economize.cloud/resources/aws/latency/us-east-1-vs-sa-east-1/) |
| us-east-1 to sa-east-1 (São Paulo) | 114-115 ms | same, [São Paulo page](https://www.economize.cloud/resources/aws/latency/sa-east-1-vs-eu-south-2/) |
| us-east-1 to eu-south-2 (Spain) | ~99 ms | [economize.cloud](https://www.economize.cloud/resources/aws/latency/us-east-1-vs-eu-south-2/) |
| US East coast client | ~10-30 ms | est. |
| US West client | ~60-90 ms | est. |
| Mexico / Colombia / Southern Cone client | ~60-110 / ~80-130 / ~130-200 ms | est. |

One-way delay between two players (est.), relay through us-east-1 vs direct:

| Players | Relay (a), warm | P2P direct |
|---|---|---|
| East US + East US | ~60-140 ms | ~15-40 ms |
| Spain + Spain | ~140-250 ms | ~15-40 ms |
| Spain + East US | ~100-190 ms | ~50-80 ms |
| Southern Cone + Southern Cone | ~200-350 ms | ~15-50 ms |
| Colombia + Spain | ~170-290 ms | ~90-130 ms |

Takeaway: for same-continent opponents outside the US, the relay can be 5-10x worse than the direct path, because both legs go to Virginia and back. Mean latency matters less in this game than jitter, because Word bullets fly for seconds and the defender judges locally; a fixed 100-250 ms delay on "Shot fired" shifts when the bullet appears but not who wins a word. Lambda cold starts and API Gateway variance are the fairness risk (bullet pops in late, or "destroyed" confirmations arrive late). A small client-side playout delay (e.g. 100-150 ms, timestamps in each event) can hide jitter under both transports.

WebRTC DataChannel can be configured reliable/ordered or unordered/unreliable (`ordered`, `maxRetransmits`, `maxPacketLifeTime`) - [MDN RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel). Events that must arrive (Shot fired, Life lost) go on a reliable ordered channel; Pace/heartbeat could use an unordered channel with `maxRetransmits: 0` to avoid head-of-line blocking. A WebSocket is TCP only, so one lost packet delays everything behind it.

## 5. WebRTC specifics

**Support.** `RTCPeerConnection`: Chrome 23+, Safari 11+, iOS Safari 11+, Firefox 22+, global usage 97% ([caniuse](https://caniuse.com/rtcpeerconnection)). `RTCDataChannel` is Baseline "widely available" since January 2020 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)). Chrome + Safari desktop are fine (phones are excluded by the map anyway). Caveats: the browser hides local IPs behind mDNS names, so two players on the same LAN may not connect directly and fall back; Safari/iOS data-only behaviour differs slightly from Chrome ([webrtcHacks](https://webrtchacks.com/safari-webrtc/)). Test Chrome-to-Safari explicitly.

**STUN (free).** `stun.cloudflare.com:3478`, free and unlimited per [Cloudflare docs](https://developers.cloudflare.com/realtime/turn/faq/). Google's `stun.l.google.com:19302` is widely used but has no published SLA. Metered Open Relay also lists STUN. STUN costs nothing for our traffic: it is only used for address discovery.

**TURN options (AWS has no managed TURN).**

| Option | Price / free tier | Notes |
|---|---|---|
| Cloudflare Realtime TURN | First 1,000 GB/month free, then $0.05/GB (egress from Cloudflare to client); free when used with Cloudflare SFU. [Pricing](https://developers.cloudflare.com/realtime/sfu/pricing/), [TURN docs](https://developers.cloudflare.com/realtime/turn/) | UDP 3478/443, TCP 3478/80, TLS 5349/443; anycast nearest edge; credentials expire up to 48 h, generated via API call (one HTTPS call from a Lambda per Match); no TCP relaying (RFC 6062); IPv4 relay only. Needs a Cloudflare account (not AWS). |
| Metered Open Relay | 20 GB/month free ([source](https://www.metered.ca/tools/openrelay/)); paid plans at metered.ca/stun-turn (not verified) | Marketing claims only, no SLA. |
| Self-host coturn on EC2 | EC2 instance always on (~$3-8/month for the smallest, **est.**) + egress ($0.09/GB beyond 100 GB/month free aggregate) | Breaks "~$0 and serverless", one more thing to run. Not recommended. |

At ~31 KB per relayed Match (est.), Cloudflare's 1,000 GB free tier covers ~32M Matches/month. TURN is effectively free at any scale this game will see.

**Realistic P2P failure rate.** No rigorous public measurement. Sources:
- Tsahi Levent-Levi (bloggeek.me, WebRTC analyst): "Most large vendors I've spoken to report 20% TURN relay traffic", some above 30%, depends on user geography and networks ([discuss-webrtc thread](https://groups.google.com/g/discuss-webrtc/c/5d_EJwM6iJM)); in the glossary he gives 0-50% depending on audience ([bloggeek.me TURN](https://bloggeek.me/webrtcglossary/turn/)).
- A callstats.io article cited in that thread: 30%.
- Several vendor blogs: 10-25%, direct success 75-90%.
- Tailscale (a similar NAT traversal problem): internal metrics say direct connections succeed in well over 90% of cases; hard NAT <-> hard NAT cannot be punched ([Tailscale connection types](https://tailscale.com/docs/reference/connection-types.md)).
- Mobile carrier-grade NAT is almost always symmetric; our users have physical keyboards, so mostly home/office broadband, which is easier than mobile.

**Planning figure: 10-30% of Matches need a relay, 20% central.** Likely lower for a desktop-only audience of home broadband, higher for university / corporate networks (UDP blocked) and for browsers or extensions that disable WebRTC. The first weeks of the real game will give the true number: log the selected ICE candidate pair type (host / srflx / relay) per Match as one of the "network round-trip per Match" metrics.

## 6. Disconnect detection (5 s grace)

Key fact: API Gateway keeps idle connections up to 10 minutes and does not tell the backend about a silent drop (Wi-Fi loss, closed laptop). `$disconnect` is "best-effort ... cannot guarantee delivery" ([docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-keys-connect-disconnect.html)). So the heartbeat is required in every option.

| | (a) WebSocket relay | (b)/(c) P2P DataChannel |
|---|---|---|
| Clean tab close / network FIN | `$disconnect` fires quickly (best-effort); also `GoneException` on the next forward | DataChannel `close` event / ICE state `disconnected`, ~seconds |
| Silent drop | App heartbeat. There is no long-lived process on Lambda to run a timer, so the opponent's client watches for missing heartbeats (2 missed at 2 s = ~4 s) and reports `opponent_silent`; the Lambda confirms with `GET @connections/{id}` (documented as a route; that it returns `lastActiveAt` is from memory of the API reference, not verified here) and awards the win after the 5 s grace. Alternative: a one-off scheduled invocation per Match (not costed here). | App heartbeat on the DataChannel (every 2 s, free). Browser-level ICE consent checks take ~30 s to fail (RFC 7675 figure from memory, not re-fetched: [RFC 7675](https://www.rfc-editor.org/rfc/rfc7675)), too slow alone, so keep the app heartbeat. |
| Cost | Included in the Match messages above (merged with Pace) | $0 on the DataChannel; ~2 server messages per disconnect to report the result |
| Detect latency | ~2-5 s | ~2-5 s |
| Reconnect within 5 s | New WS connection id, Lambda re-binds it to the Match (1 DynamoDB write); lost events must be replayed from a small buffer | Needs an ICE restart over the signaling socket; if that fails inside 5 s the Match is lost for that player. Fallback transport switch to WS relay mid-Match is a natural recovery path in (c). |

For (b)/(c) keep the WebSocket open during the Match as signaling + arbitration channel: 2 players x 2 min x $0.25/M = ~$0.000001. It costs nothing in messages when idle. Because both players may lie, "who disconnected" arbitration is trust-based. This is consistent with the map's existing trust model (defender's client judges locally) but note it for the anti-cheat conversation.

## 7. Option comparison

| | (a) WS only | (b) P2P only | (c) P2P + WS fallback |
|---|---|---|---|
| Cost / Match (base) | $0.00063 | $0.000077 | $0.00020 (20% fallback) |
| Players that cannot play | 0% | 10-30% (no relay) | 0% |
| Latency (non-US pairs) | worst (via Virginia) | best | best for ~80%, (a) for the rest |
| Jitter / cold starts | Lambda in every message | none after connect | none for ~80% |
| Server work during Match | every message | none | none for ~80% |
| Words for attack (server-picked) | server sends each word | must be delivered as a batch at Match start or via a side channel | same as (b) in P2P, per message in fallback |
| Complexity | lowest | medium (SDP, ICE, restart) | highest (two paths + switch) |
| New third-party dependency | none | STUN (+TURN if added) | STUN only |
| Disconnect handling | server sees the socket | peers + server arbitration | both |

Notes on (b)/(c): Attack words must come from the server (different sequence per player, length ramp). In P2P the server cannot hand out a word per Shot, so it must pre-generate a batch (e.g. 60 words with the length ramp baked in, enough for a long Match) at Match start, and send a refill when needed over the signaling socket. This is a design point for the "Attack word server logic" ticket.

### Also considered: AWS IoT Core MQTT over WebSocket (option d)

Same $1.00 per million messages (5 KB metering), $0.08 per million connection minutes, 12-month free tier of 500,000 messages / 2,250,000 connection minutes ([IoT Core pricing](https://aws.amazon.com/iot-core/pricing/)). Publish and delivery are separate messages, so per-Match message cost matches (a), but there is no Lambda or DynamoDB in the path (saves ~$0.00011 per Match and the Lambda hop latency), and Last Will / presence events give disconnect detection. Limits: 100 publishes/s per connection, 128 KB payload, keep-alive 30-1,200 s, 500,000 connections per account ([IoT Core quotas](https://docs.aws.amazon.com/general/latest/gr/iot-core.html)). Downsides: anonymous browser auth needs Cognito identity pool or a custom authorizer, topic-level IAM policies to stop spoofing, and it is another concept for the IaC. Cost is not materially better than (a); only latency/jitter is. Worth a one-day spike if (a)'s measured jitter is bad; not recommended as the first move.

## 8. Recommendation: (c), built in two steps

1. **Step 1 (needed anyway):** API Gateway WebSocket + Lambda + DynamoDB for Matchmaking, Invite links, signaling, Countdown, and the full in-Match event relay (option a). Define one transport interface (`send(event)`, `onEvent`, `onPeerGone`) with events being the same JSON on any transport.
2. **Step 2:** add a WebRTC DataChannel transport with STUN only. Start P2P during the Matchmaking/Countdown window; the Countdown starts when the DataChannel is open on both sides or after a hard deadline (~4 s) switches that Match to the WS relay. Re-evaluate adding Cloudflare TURN once the real fallback rate is logged.

Why: (c) is the only option that covers every player, cuts cost ~3x (and ~8x if you consider only P2P Matches), and removes the Virginia detour for the majority of Matches. Doing the WebSocket path first keeps the first playable online build simple and de-risks the fallback.

## 9. Risks

- **API Gateway message cost dominates.** One heavier Match design (separate heartbeat, 1 Hz Pace) doubles cost. Mitigation: coalesce Pace + heartbeat, send heartbeat only when silent, count messages in a test.
- **Free tier is not what the old docs say.** New accounts get credits that expire at 6 months and the free plan then closes the account. Budget with no credits.
- **Lambda cold starts / new-account concurrency quotas** cause jitter and throttling on the relay path. Mitigation: initialise SDK clients outside the handler, small bundle, check Service Quotas, consider a provisioned-concurrency of 1-2 only if jitter is bad (it is billed even when idle, so check the cost first).
- **P2P setup time and failure paths.** ICE may take 1-5 s and fail late. Need hard deadline + fallback + `ICE restart` handling for the 5 s grace.
- **Safari / Chrome interop** not tested here; mDNS host candidates and same-LAN pairs may drop to relay.
- **Trust.** Both transports rely on clients to report outcomes; P2P additionally lets a client lie about a disconnect. Acceptable for a casual game; record it as a known property.
- **Web search sources are mixed quality.** P2P failure rates come from vendor blogs and a forum thread, not measured studies.

## 10. What remains uncertain

1. Actual added latency/jitter of API Gateway WebSocket + Lambda, from Spain / Latin America / US. Needs a prototype that echoes through the real stack from three vantage points (p50/p95/p99 and a cold-start histogram).
2. Real P2P success rate for this audience (Chrome + Safari desktop). Log candidate-pair type from day one.
3. Whether the AWS account is legacy (12-month free tier) or new (6-month credit plan).
4. Actual messages per Match, which depend on Match rules not yet tuned (Shot rate, Match length). The cost table scales linearly; re-run when the rules are final.
5. Best design for the 5 s grace on API Gateway (client-watchdog + `GET @connections` vs a scheduled invocation); prototype both.
6. Whether Cloudflare's free TURN terms still apply to this use (the docs describe the pricing; I did not verify account requirements).

## Sources

- [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/)
- [API Gateway endpoints and quotas (general reference)](https://docs.aws.amazon.com/general/latest/gr/apigateway.html)
- [Quotas for WebSocket APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)
- [`@connections` commands](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html)
- [`$connect` / `$disconnect` routes](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-route-keys-connect-disconnect.html)
- [AWS Free Tier](https://aws.amazon.com/free/) and [Choosing a plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [Lambda execution environment / cold starts](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
- [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [AWS IoT Core pricing](https://aws.amazon.com/iot-core/pricing/), [IoT Core quotas](https://docs.aws.amazon.com/general/latest/gr/iot-core.html)
- Cloudflare: [TURN overview](https://developers.cloudflare.com/realtime/turn/), [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/), [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/pricing/)
- [Metered Open Relay](https://www.metered.ca/tools/openrelay/)
- [caniuse RTCPeerConnection](https://caniuse.com/rtcpeerconnection), [MDN RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel), [webrtcHacks Safari](https://webrtchacks.com/safari-webrtc/), [RFC 7675](https://www.rfc-editor.org/rfc/rfc7675)
- P2P failure rates: [discuss-webrtc thread](https://groups.google.com/g/discuss-webrtc/c/5d_EJwM6iJM), [bloggeek.me TURN](https://bloggeek.me/webrtcglossary/turn/), [Tailscale connection types](https://tailscale.com/docs/reference/connection-types.md)
- Latency proxies: [economize.cloud us-east-1 vs sa-east-1](https://www.economize.cloud/resources/aws/latency/us-east-1-vs-sa-east-1/), [us-east-1 vs eu-south-2](https://www.economize.cloud/resources/aws/latency/us-east-1-vs-eu-south-2/); WebSocket+Lambda overhead anecdote: [Markaicode](https://www.markaicode.com/websocket-gold-price-lambda-optimization/)
