// Live check of matchmaking and signaling through CloudFront, against the deployed DynamoDB table:
//   npm run smoke:api -- https://<distribution>.cloudfront.net
// Two fake players queue, pair, trade an offer and an answer, confirm, and leave.
import { createHash, randomBytes } from "node:crypto";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) throw new Error("usage: smoke-api.ts <base url>");

const pid = () => `smoke-${randomBytes(8).toString("hex")}`;
const A = pid();
const B = pid();

/** CloudFront signs POSTs to the Function URL, which needs the body's SHA-256 in a header. */
async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(base + path, {
    method,
    body: text,
    headers: text
      ? { "content-type": "application/json", "x-amz-content-sha256": createHash("sha256").update(text).digest("hex") }
      : {},
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> };
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

const a = await call("POST", "/api/queue", { pid: A, lang: "en", listVersion: "smoke" });
check("host queues and waits", a.status === 200 && a.body.status === "waiting", a);
const id = a.body.matchId;

const b = await call("POST", "/api/queue", { pid: B, lang: "en", listVersion: "other" });
check("guest pairs with the host", b.body.matchId === id && b.body.role === "guest" && b.body.status === "paired", b);
check("guest gets seeds and the host's list version", typeof b.body.seeds?.mine === "number" && b.body.listVersion === "smoke", b);

const hostPoll = await call("GET", `/api/match/${id}?pid=${A}`);
check("host sees the pairing with swapped seeds", hostPoll.body.status === "paired" && hostPoll.body.seeds?.mine === b.body.seeds?.theirs, hostPoll);

check("host sends the offer", (await call("POST", `/api/match/${id}/signal`, { pid: A, type: "offer", sdp: "v=0 offer" })).status === 200);
check("guest receives the offer", (await call("GET", `/api/match/${id}?pid=${B}`)).body.offer === "v=0 offer");
check("guest sends the answer", (await call("POST", `/api/match/${id}/signal`, { pid: B, type: "answer", sdp: "v=0 answer" })).status === 200);
check("host receives the answer", (await call("GET", `/api/match/${id}?pid=${A}`)).body.answer === "v=0 answer");

check("a stranger is refused", (await call("GET", `/api/match/${id}?pid=${pid()}`)).status === 403);
check("a bad request is refused", (await call("POST", "/api/queue", { pid: "x", lang: "en", listVersion: "v" })).status === 400);

check("host confirms", (await call("POST", `/api/match/${id}/connected`, { pid: A })).body.bothConnected === false);
check("guest confirms: both connected", (await call("POST", `/api/match/${id}/connected`, { pid: B })).body.bothConnected === true);

check("private: create and join", await (async () => {
  const made = await call("POST", "/api/match", { pid: A, lang: "es", listVersion: "smoke" });
  const joined = await call("POST", `/api/match/${made.body.matchId}/join`, { pid: B });
  const third = await call("POST", `/api/match/${made.body.matchId}/join`, { pid: pid() });
  await call("POST", `/api/match/${made.body.matchId}/leave`, { pid: A });
  return joined.body.status === "paired" && third.body.error === "full";
})());

// A connection record is log only (no history item). Browser "Smoke" so queries can leave these out.
const p2p = { t: "p2p", br: "Smoke", os: "Other", ret: false, mid: id, kind: "public", role: "host", ok: true, fail: null, pair: "host", ms: 1, gather: 1, ice: [], cand: { lh: 0, ls: 0, lr: 0, rh: 0, rs: 0, rr: 0 } };
check("a metrics report is accepted", (await call("POST", "/api/report", { pid: A, r: p2p })).status === 200);
check("a bad metrics report is refused", (await call("POST", "/api/report", { pid: A, r: { ...p2p, t: "nope" } })).status === 400);

await call("POST", `/api/match/${id}/leave`, { pid: A });
check("left matches are gone", (await call("GET", `/api/match/${id}?pid=${B}`)).status === 404);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
