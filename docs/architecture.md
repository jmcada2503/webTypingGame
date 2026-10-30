# Architecture

Serverless on AWS (`us-east-1`), static site on S3 + CloudFront, **P2P WebRTC** for the in-Match
connection. The backend (Lambda + DynamoDB) only does Matchmaking, signaling, presence, metrics and
cost guardrails — it is never in the hot path of a Match. Target: ~$0 at low/middle traffic under a
hard ~$5/month cap.

Full decision record: [backend architecture ticket](https://github.com/jmcada2503/webTypingGame/issues/61#issuecomment-6477666649)
and the [map](https://github.com/jmcada2503/webTypingGame/issues/38).

## Diagram

The draw.io source is embedded below — paste it into draw.io ([app.diagrams.net](https://app.diagrams.net)) via **Extras → Edit Diagram**, or open this file with the VS Code Draw.io Integration extension.

```drawio
<mxfile host="app.diagrams.net" type="device">
  <diagram name="web-typing-game-architecture" id="arch-1">
    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1500" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="cloud" value="AWS&#160;&#8226;&#160;us-east-1" style="rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;fillColor=#fff8f0;strokeColor=#ff9900;fontColor=#8a5000;fontSize=14;fontStyle=1;arcSize=4;" vertex="1" parent="1">
          <mxGeometry x="400" y="20" width="1020" height="820" as="geometry" />
        </mxCell>
        <mxCell id="players" value="Players (browsers, desktop + physical keyboard)" style="rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;fillColor=#f5f5f5;strokeColor=#999999;fontColor=#333333;fontSize=13;fontStyle=1;arcSize=6;" vertex="1" parent="1">
          <mxGeometry x="30" y="120" width="340" height="620" as="geometry" />
        </mxCell>
        <mxCell id="stun" value="STUN servers (free, no account)&#10;stun.cloudflare.com&#160;&#160;+&#160;&#160;stun.l.google.com" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=11;" vertex="1" parent="1">
          <mxGeometry x="30" y="30" width="340" height="60" as="geometry" />
        </mxCell>
        <mxCell id="bA" value="&lt;b&gt;Browser A&lt;/b&gt;&#10;(TypeScript + Vite, ASCII/CRT render)&#10;&#10;&#8226; Screens: menu, how-to, waiting, countdown, match, end&#10;&#8226; Match rules engine (local, authoritative on own defense)&#10;&#8226; Seeded attack-word picker + verifier&#10;&#8226; P2P transport (WebRTC DataChannel)&#10;&#8226; Signaling client (HTTP poll)&#10;&#8226; Practice: runs fully in-browser" style="rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=6;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="55" y="165" width="290" height="230" as="geometry" />
        </mxCell>
        <mxCell id="bB" value="&lt;b&gt;Browser B&lt;/b&gt;&#10;(opponent — same client)&#10;&#10;&#8226; Independent attack-word seed&#10;&#8226; Verifies A&apos;s words + fire times&#10;&#8226; Judges its own defense" style="rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=6;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="55" y="480" width="290" height="230" as="geometry" />
        </mxCell>
        <mxCell id="cf" value="&lt;b&gt;CloudFront&lt;/b&gt;&#10;(Shield Standard: L3/L4, free)&#10;pay-as-you-go, no WAF" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=11;" vertex="1" parent="1">
          <mxGeometry x="440" y="130" width="200" height="90" as="geometry" />
        </mxCell>
        <mxCell id="s3" value="&lt;b&gt;S3 &#8212; Static stack&lt;/b&gt;&#10;&#8226; site bundle&#10;&#8226; /status.json (resting flag)&#10;&#8226; /words/&lt;lang&gt;.&lt;hash&gt;.json (gz/br, immutable)" style="rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=6;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="440" y="290" width="230" height="120" as="geometry" />
        </mxCell>
        <mxCell id="api" value="&lt;b&gt;Lambda: api&lt;/b&gt;&#10;Function URL + OAC&#10;Node arm64, esbuild&#10;reserved concurrency 10&#8211;20 (rate cap)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="740" y="130" width="210" height="90" as="geometry" />
        </mxCell>
        <mxCell id="ddb" value="&lt;b&gt;DynamoDB&lt;/b&gt; (provisioned 25/25, free)&#10;&#8226; matches&#160;&#160;Q#&lt;lang&gt; pointer + M#&lt;id&gt;&#10;&#8226; presence&#160;&#160;P#&lt;lang&gt;#&lt;60s bucket&gt;&#10;&#8226; match_details&#160;&#160;pk pid, sk at#id#n&#10;TTL = cleanup only; liveness via lastSeen" style="rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=6;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="740" y="290" width="250" height="140" as="geometry" />
        </mxCell>
        <mxCell id="cw" value="&lt;b&gt;CloudWatch Logs&lt;/b&gt;&#10;1 JSON line / record&#10;+ Logs Insights saved queries&#10;(analytics / time-range metrics)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="740" y="490" width="250" height="90" as="geometry" />
        </mxCell>
        <mxCell id="eb" value="&lt;b&gt;EventBridge&lt;/b&gt;&#10;every 15 min" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="1060" y="130" width="200" height="60" as="geometry" />
        </mxCell>
        <mxCell id="gr" value="&lt;b&gt;Lambda: guardrails&lt;/b&gt;&#10;cost estimator (trip @ 80%)&#10;+ killer (shutdown)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="1060" y="260" width="200" height="100" as="geometry" />
        </mxCell>
        <mxCell id="bud" value="&lt;b&gt;AWS Budgets&lt;/b&gt;&#10;alerts 20/60/100% of limit" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="1060" y="480" width="200" height="60" as="geometry" />
        </mxCell>
        <mxCell id="sns" value="SNS" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="1060" y="580" width="200" height="40" as="geometry" />
        </mxCell>
        <mxCell id="ssm" value="&lt;b&gt;SSM Parameter&lt;/b&gt;&#10;monthly limit ($)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;fontSize=10;" vertex="1" parent="1">
          <mxGeometry x="1060" y="660" width="200" height="60" as="geometry" />
        </mxCell>
        <mxCell id="e_p2p" value="WebRTC DataChannel &#8212; DIRECT P2P&#10;reliable+ordered; events (Shot / defend / Life / seq+ack heartbeat)" style="endArrow=classic;startArrow=classic;html=1;strokeColor=#b85450;strokeWidth=3;fontColor=#b85450;fontSize=10;fontStyle=1;" edge="1" parent="1" source="bA" target="bB">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_sA" value="ICE" style="endArrow=classic;html=1;dashed=1;strokeColor=#9673a6;fontSize=9;" edge="1" parent="1" source="bA" target="stun">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_sB" value="ICE" style="endArrow=classic;html=1;dashed=1;strokeColor=#9673a6;fontSize=9;exitX=0;exitY=0.5;exitDx=0;exitDy=0;" edge="1" parent="1" source="bB" target="stun">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_acf" value="HTTPS&#10;static + /api/* (signaling, matchmaking, presence, report)" style="endArrow=classic;startArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="bA" target="cf">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_cfs3" value="origin: site, status, words" style="endArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="cf" target="s3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_cfapi" value="origin /api/* (OAC)&#10;POST: x-amz-content-sha256" style="endArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="cf" target="api">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_apiddb" value="read/write&#10;(conditional, atomic)" style="endArrow=classic;startArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="api" target="ddb">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_apicw" value="report: 1 line/match" style="endArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="ddb" target="cw">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_ebgr" value="trigger" style="endArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="eb" target="gr">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_budsns" value="" style="endArrow=classic;html=1;strokeColor=#333333;fontSize=9;" edge="1" parent="1" source="bud" target="sns">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_snsgr" value="backup trigger" style="endArrow=classic;html=1;strokeColor=#333333;fontSize=9;exitX=0.5;exitY=0;exitDx=0;exitDy=0;" edge="1" parent="1" source="sns" target="gr">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_grcw" value="read usage" style="endArrow=classic;html=1;dashed=1;strokeColor=#d79b00;fontSize=9;" edge="1" parent="1" source="gr" target="cw">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_grs3" value="write /status.json (resting)" style="endArrow=classic;html=1;dashed=1;strokeColor=#d79b00;fontSize=9;" edge="1" parent="1" source="gr" target="s3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_grapi" value="set concurrency = 0" style="endArrow=classic;html=1;dashed=1;strokeColor=#d79b00;fontSize=9;" edge="1" parent="1" source="gr" target="api">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e_grssm" value="read limit" style="endArrow=classic;html=1;dashed=1;strokeColor=#d79b00;fontSize=9;" edge="1" parent="1" source="gr" target="ssm">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## Components

**Client (browser).** TypeScript + Vite, ASCII/CRT render layer. Holds all screens, the Match rules
engine (authoritative on its own defense), the seeded attack-word picker + verifier, the P2P transport,
and the HTTP signaling client. Practice runs fully in-browser with no backend.

**Edge — CloudFront.** One distribution, two origins: S3 (static site, `/status.json`, word lists)
and the `api` Lambda Function URL via Origin Access Control. `/api/*` is same-origin (no CORS). POST to
a Function URL origin must send `x-amz-content-sha256` (client hashes the body with `crypto.subtle`).
Shield Standard (L3/L4) is free; no WAF.
The game is served from **typewing.net** (registered in Route 53; the stack's `ZONE_ID` is its hosted zone). An ACM
certificate (us-east-1, DNS-validated) covers the apex and `www`; A/AAAA alias records point both at the distribution,
and a viewer-request CloudFront Function answers `www` with a 301 to the apex. The `*.cloudfront.net` URL keeps working.

**`api` Lambda.** All routes behind one Lambda (warmer, cheaper): `POST queue`, `POST match`,
`POST match/{id}/join`, `GET match/{id}`, `POST match/{id}/signal`, `POST match/{id}/connected`,
`POST match/{id}/leave`, `POST presence`, `GET online`, `POST report`. Reserved concurrency 10–20 doubles as the rate cap.
Matchmaking and signaling live in `infra/lambda/api/` as a `Matchmaker` over a small atomic `Store` (in-memory for
tests and local dev, DynamoDB conditional writes in the cloud). Players are anonymous ids (`pid`) in the body or the
`pid` query of `GET match/{id}`; the host's word-list version wins at pairing; a waiter or opponent who hasn't polled
for 10 s is gone (polls write liveness at most every 4 s). Errors are `{error}` codes: `invalid` 400, `forbidden` 403,
`gone`/`expired` 404, `full`/`own` 409, `too_large` 413, `busy` 503. `npm run smoke:api -- <url>` in `infra/` checks it live.

**DynamoDB** (provisioned 25/25 in total, always-free, shared per region; `matches` has 10/10):
- `matches` — `Q#<lang>` single pointer (≤1 waiter/language) + `M#<id>` match items (seeds, SDP, status, `*Seen`).
- `presence` — `P#<lang>#<60s bucket>` counters (2 R / 3 W); online = last complete bucket. Every open tab
  (`src/net/presence.ts`) beats once per wall-clock window at a fixed random offset (2–55 s in), which also keeps
  `api` warm. Above 50 tabs online it's **sampled**: `GET online` publishes `sample = 50 / total`, each tab beats
  with that probability, and the server adds `1 / sample` per beat (the rate it derives itself from the window
  before, cached per window), so ~50 heartbeats per minute however many players. `GET online` returns both
  languages with `Cache-Control: max-age=30` (CloudFront caches it) and logs `online_count` for the peak-players
  query. A throttled heartbeat is dropped, never billed.
- `match_details` — one item per player per Match (incl. Practice), keyed `pid` / `<at>#<matchId>#<n>` (Practice:
  `<at>#<runId>`); 10 R / 12 W, no TTL, accounts-ready. Written with `attribute_not_exists` (a retry is a
  duplicate); over capacity the item is dropped (no SDK retries) and the log line says `dropped: 1`.

TTL is cleanup only (deletes can lag ~48 h); liveness is checked in code via `lastSeen`/`*Seen`.

**Metrics** (`infra/lambda/api/metrics.ts`, client `src/metrics/`). The browser sends `POST report` with one
record: `match` (my side of a Match, every Rematch its own, incl. the attack list), `practice`, `p2p` (every
connection attempt: ICE timeline, path type, time to connect, failure, candidates each side offered), `mm`
(Matchmaking given up, with the wait) and `rematch` (how the offer was settled). `MetricsTracker` derives them
from `ScreenFlow.onChange` (every state, also in background tabs); a tab closing mid-Match reports `quit` via a
`keepalive` fetch. The server validates strictly (unknown fields dropped, sizes capped), adds `cc` from
`CloudFront-Viewer-Country` (forwarded by the `/api/*` origin request policy), never the IP or full UA, writes
`match`/`practice` to `match_details`, and emits one pure-JSON stdout line per record (no `console.log` prefix,
so Logs Insights sees the fields; booleans as 0/1, `fail: "none"` on success; the attack list stays out of the
log). Retention 180 days. Saved queries (`infra/lib/metrics-queries.ts`, folder `typing-game/`) include
**P2P failure rate by browser/country** (the TURN / WebSocket-fallback decision). Kill switch:
`METRICS_SAMPLE_RATE` in `infra/lib/backend-stack.ts` (0 = off; below 1, lines carry weight `w`). Faked stats
are possible (collect-only).

**Cost guardrails** (own CDK stack `Guardrails`, after `Backend` and `Static`). `guardrails` Lambda,
three triggers: EventBridge (15 min) sums month-to-date CloudWatch usage (CloudFront requests/bytes,
account-wide Lambda invocations/duration, log ingestion), prices it **net of always-free allowances** at
worst-region CloudFront prices, and trips "resting" at 80% of the limit; an SNS topic fed by AWS Budgets
(100%) and the `EstimatedCharges` billing alarm forces a trip as the slow backup. Shutdown = `api`
concurrency 0, then `/status.json {resting:true}` (`max-age=30`) + invalidation. Auto-lift on the 1st.
The limit lives in one SSM parameter; `guardrails:limit <usd> [--resume]` updates it plus the budget and
alarm, `guardrails:resume` lifts (refused while the estimate is still over the trip point). The client
treats a missing flag as open and two failed reads in a row as resting.

**External STUN.** Cloudflare + Google, both free. TURN is deliberately omitted; if connection metrics
show frequent P2P failures, add TURN or a WebSocket fallback later (fog on the map).

## Key flows

**Matchmaking (Public).** Searcher does a conditional `DeleteItem` on `Q#<lang>`. Hit → claim that
`M#`, set self as guest, issue seeds, status `paired`. Miss → create own `M#`, `PutItem` pointer if absent,
wait. Races: loser retries ≤3. A Public match is a Private match whose host also sits in the queue.

**Handshake.** After pairing the waiter (host) makes the WebRTC offer (ICE ≤1.5 s, no trickle);
offer/answer exchanged through the `M#` item, polled 0.5–1 s. On `connected`, host sends `startAt` in its
clock; guest converts via a ping-pong clock offset so both Countdowns end together. ~3–5 s total.
Client: `src/net/OnlineNetwork.ts` (the `FlowNetwork` the screens use) polls ~2 s while waiting and 0.7 s
during the handshake, and the guest refuses a host whose `listVersion` (word-list hash + `ATTACK_PICKER_VERSION`)
differs from its own. Match *k* on one connection (0, then each Rematch) starts its Attack-word indices at
`k × REMATCH_INDEX_STRIDE`, so both sides agree without sending indices. The word lists ship inside the code
bundle (they change only with a deploy); the build writes `/version.json` (each language's `listVersion`, served
no-cache) and the client fetches it right before every queue or link join, reloading onto the new build if it is
behind (an Invite link survives the reload). `npm run dev` serves `/api` from the
real matchmaking code over the in-memory store (`vite.devApi.ts`); `?fake` uses the in-memory flow fake instead.

**In-Match (hot path, no AWS).** Events flow Browser↔Browser over the reliable+ordered DataChannel, each
with seq+id (ignore dupes); a 2 s heartbeat carries a cumulative ack, and 4 s of silence is a signal loss (`signalLost`) and 14 s ends the connection (4 s to notice plus the Match's 10 s grace). When the signal returns the host sends `resumeAt {at}` so both sides' resume countdown ends together (the guest converts with the clock offset).
Attack words come from each player's seed; a Shot carries `{i, t_i, word}` and the opponent recomputes the
word and checks `t_i` against the previous Shot's arrival time (mismatch → ignore + log `invalid_attack`).
Rematch reuses the open channel and the same seeds (`i` continues) — it works even while the backend rests.

**Report.** At Match end each client fires `POST report` (fire-and-forget; dropped if resting).

**Guardrail trip.** Estimator ≥80% → resting. New online Matches and the queue show the resting screen
(budget note + GitHub Sponsors link); running Matches and Rematches continue over P2P; Practice is unaffected.

## Cost & limits

| Concern | Choice | Hard $0 ceiling? |
|---|---|---|
| In-Match traffic | P2P WebRTC (no AWS per-message cost) | yes (STUN free) |
| Lambda | Function URL, no extra charge; always-free 1M req/mo | within free tier |
| DynamoDB | provisioned 25/25 (free), shared per region | yes — throttles instead of billing |
| Static + edge | S3 + CloudFront pay-as-you-go (10M req/mo free) | no, bounded by guardrails |
| Analytics | CloudWatch Logs (5 GB/mo free) | mostly |
| Overrun | estimator trips ~$4; Budgets backup | overage ~$0.1–0.5 (estimator) |

Scaling notes: presence writes stay ~50/min at any size (sampling); ~1,000 concurrent exceeds the $5 cap
(resting triggers). The project account is a legacy Paid account: no Free-plan hard stop, so the
guardrails are the only cap.

## Out of scope

Accounts, saved progress/stats, rankings; custom domain; staging environment; TURN/WebSocket fallback
(revisited only if metrics demand it).
