/**
 * Logs Insights saved queries over the api log group (console: CloudWatch → Logs Insights → Saved queries,
 * folder "typing-game"). Every metrics line is pure JSON: `t` is the record type (match, practice, p2p, mm,
 * rematch); the online count lines have `event = "online_count"`. Booleans are 0/1.
 *
 * Counts use `count(*)`: right while METRICS_SAMPLE_RATE is 1. When sampling, lines carry `w` (records each
 * line stands for): use `sum(w)` instead.
 */
export const METRICS_QUERIES: Record<string, string> = {
  "Matches and players per day": `filter t = "match" or t = "practice"
| stats count_distinct(concat(mid, "#", n)) as matches, sum(t = "practice") as practiceRuns, count_distinct(pid) as players by bin(1d) as day
| sort day desc`,

  "Returning vs new players per day": `filter t = "match" or t = "practice"
| stats count_distinct(pid) as players by bin(1d) as day, ret
| sort day desc`,

  "Match endings": `filter t = "match"
| stats count(*) as reports by kind, lang, end
| sort reports desc`,

  "Pace and WPM": `filter t = "match" or t = "practice"
| stats count(*) as runs, avg(wpm) as avgWpm, pct(wpm, 50) as p50, pct(wpm, 90) as p90, max(wpm) as best, avg(acc) as accuracy by t, lang, bin(1w) as week
| sort week desc`,

  "Hardest words": `filter t = "match" or t = "practice"
| fields jsonParse(@message) as m
| unnest m.missed into word
| stats count(*) as missed by lang, word
| sort missed desc
| limit 100`,

  "P2P failure rate by browser/country": `filter t = "p2p" and fail != "aborted"
| stats count(*) as attempts, 100 * (count(*) - sum(ok)) / count(*) as failPct, sum(pair = "relay") as relayed by br, os, cc
| sort attempts desc`,

  "P2P failure reasons": `filter t = "p2p" and ok = 0
| stats count(*) as failures, avg(cand.ls) as localSrflx, avg(cand.rs) as remoteSrflx by fail, br, role
| sort failures desc`,

  "P2P path type and time to connect": `filter t = "p2p" and ok = 1
| stats count(*) as connections, pct(ms, 50) as p50ms, pct(ms, 90) as p90ms by pair, br
| sort connections desc`,

  "Matchmaking waits and give-ups": `filter (t = "match" and n = 0 and ispresent(wait)) or t = "mm"
| fields if(t = "mm", "gaveUp", "matched") as outcome
| stats count(*) as players, pct(wait, 50) as p50ms, pct(wait, 90) as p90ms by outcome, kind, lang, bin(1d) as day
| sort day desc`,

  "Rematch outcomes": `filter t = "rematch"
| stats count(*) as offers by kind, out
| sort offers desc`,

  "Shot checks (cheating signals)": `filter t = "match"
| stats sum(invalid) as rejected, sum(near) as nearMisses, count(*) as reports by bin(1d) as day
| sort day desc`,

  "Online peak per hour": `filter event = "online_count"
| stats max(total) as peak, max(en) as en, max(es) as es by bin(1h) as hour
| sort hour desc`,

  "Metrics dropped from the history (over capacity)": `filter dropped = 1
| stats count(*) as items by t, bin(1h) as hour
| sort hour desc`,
};
