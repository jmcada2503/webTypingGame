// The game: the screen flow, the screens, and the game scene, mounted by the app shell.
import './app/app.css';
import { AppShell } from './app/AppShell';
import { isTouchOnly } from './app/keyboardGate';
import { runKeyboardGate } from './app/runKeyboardGate';
import { installDevKeys } from './dev/devKeys';
import { FakeBackend } from './flow/FakeNetwork';
import { ScreenFlow } from './flow/ScreenFlow';
import { KeyboardTypingInput } from './input/KeyboardTypingInput';
import { REMATCH_INDEX_STRIDE, createAttackWordSource } from './match/attackWords';
import { MatchEngine } from './match/MatchEngine';
import { MatchSession } from './match/MatchSession';
import { MetricsTracker } from './metrics/MetricsTracker';
import { clientInfo, createReporter } from './metrics/reporter';
import { ShotVerifier } from './match/ShotVerifier';
import { createApi, createPresenceApi } from './net/api';
import { checkFreshness } from './net/freshness';
import { listVersion, playerId } from './net/identity';
import { OnlineNetwork } from './net/OnlineNetwork';
import { startPresence } from './net/presence';
import { createServerStatus } from './net/serverStatus';
import { PracticeSession } from './practice/PracticeSession';
import { ScreenHost } from './screens/ScreenHost';
import { howtoScreen } from './screens/howtoScreen';
import { countdownScreen } from './screens/countdownScreen';
import { menuScreen } from './screens/menuScreen';
import { placeholderOnline } from './screens/content';
import { opponentLeftScreen } from './screens/opponentLeftScreen';
import { simpleScreens } from './screens/simpleScreens';
import { waitingScreen } from './screens/waitingScreen';
import { AsciiGameView } from './view/AsciiGameView';
import { loadWordList } from './words/wordLists';

/** Diagnostics that are not metrics records (errors, version checks, each Shot-check detail): console only. */
const logMetric = (entry: Record<string, unknown>) => console.info(JSON.stringify(entry));

const view = await AsciiGameView.create();
// Phones and tablets without a mouse or trackpad get a "needs a physical keyboard" screen until a real key is pressed.
if (isTouchOnly(window)) await runKeyboardGate(view);

// Word lists are small (about 50 KB each, compressed): load both before the first screen.
const wordLists = { en: await loadWordList('en'), es: await loadWordList('es') };
const versions = { en: listVersion(wordLists.en), es: listVersion(wordLists.es) };

const pid = playerId();
const safeStorage = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();
/** Metrics (`POST /api/report`): Matches, Practice runs, connection attempts, Matchmaking give-ups, Rematches. */
const report = createReporter(pid, clientInfo(navigator.userAgent, safeStorage, new Date().toISOString().slice(0, 10)));
// Assigned below, once the flow exists; connection records can only arrive after that.
let metrics: MetricsTracker | null = null;
// `?fake` plays against the in-memory stand-in (with the dev keys) instead of the real backend and WebRTC.
const backend = new URLSearchParams(location.search).has('fake') ? new FakeBackend() : null;
const online = backend
  ? null
  : new OnlineNetwork({
      api: createApi(pid),
      listVersion: (lang) => versions[lang],
      inviteLink: (matchId) => `${location.origin}${location.pathname}#/m/${matchId}`,
      onRecord: (record, match) => metrics?.connection(record, match),
      log: logMetric,
      // A tab left open across a deploy may hold old word lists: reload onto the new build before joining.
      beforeJoin: async (code) => {
        if ((await checkFreshness(versions)) !== 'stale') return true;
        logMetric({ event: 'stale_build_reload' });
        if (code) history.replaceState(null, '', `${location.pathname}${location.search}#/m/${code}`); // keep the link
        location.reload();
        return false;
      },
    });
const flow = new ScreenFlow(online ?? backend!.connect());

// Every open tab counts as online (menu, queue, Match); the menu and waiting screens show the count.
const presenceApi = online ? createPresenceApi(pid) : null;
const presence = presenceApi ? startPresence({ language: () => flow.language(), beat: presenceApi.beat, fetchOnline: presenceApi.online }) : null;
const onlineCounts = (t: number) => (presence ? (presence.counts() ?? { en: 0, es: 0, total: 0 }) : placeholderOnline(t));
const input = new KeyboardTypingInput();
const copyText = (s: string) => void navigator.clipboard?.writeText(s).catch(() => {});
// The approved designs replace the plain screens one by one; the rest stay plain until their prototypes are done.
const screens = { ...simpleScreens(flow, () => practice?.result() ?? null, () => (lastMatch ? { stats: lastMatch.stats(), enemyDamage: lastMatch.state().enemyDamage } : null)), menu: menuScreen(flow, copyText, onlineCounts), howto: howtoScreen(flow), waiting: waitingScreen(flow, copyText, onlineCounts), countdown: countdownScreen(), opponentLeft: opponentLeftScreen(flow) };

/** The Practice run being played (or the last one), so its end screen can show the results. */
let practice: PracticeSession | null = null;
/** How many Matches each connection has started (the first, then Rematches): picks the Attack-word indices. */
const matchesPlayed = new Map<string, number>();
/** The online Match being played (or the last one), so its end screen can show the stats. */
let lastMatch: MatchSession | null = null;

/**
 * What runs on the Match screen. Practice: the real `PracticeSession`. Online: the Match engine with my seeded
 * Attack words, the opponent's Shots checked against their seed, and the P2P channel to them. With `?fake` there
 * is no opponent channel: a local seed and no transport.
 */
const createMatch = (mode: 'versus' | 'practice') => {
  if (mode === 'practice') return (practice = new PracticeSession({ list: wordLists[flow.language()] }));
  const opponent = online?.currentMatch();
  if (!opponent) {
    const attackWords = createAttackWordSource(Math.floor(Math.random() * 2 ** 32), wordLists[flow.language()]);
    return (lastMatch = new MatchSession(new MatchEngine({ mode, attackWords, bulletFlightSeconds: 8, shotFlightSeconds: 8 })));
  }
  const list = wordLists[opponent.lang];
  const played = matchesPlayed.get(opponent.matchId) ?? 0;
  matchesPlayed.set(opponent.matchId, played + 1);
  const startIndex = played * REMATCH_INDEX_STRIDE;
  const verifier = new ShotVerifier({
    seed: opponent.seeds.theirs,
    list,
    startIndex,
    oneWayLatency: opponent.oneWaySeconds,
    report: (audit) => {
      logMetric({ event: audit.kind, matchId: opponent.matchId, ...audit });
      metrics?.shotAudit(audit.kind);
    },
  });
  const engine = new MatchEngine({
    mode,
    attackWords: createAttackWordSource(opponent.seeds.mine, list),
    startIndex,
    verifyShot: (shot, arrivedAt) => verifier.verify(shot, arrivedAt).ok,
    bulletFlightSeconds: 8,
    shotFlightSeconds: 8,
  });
  return (lastMatch = new MatchSession(engine, opponent.transport));
};
const host = new ScreenHost(view, flow, screens, createMatch);
new AppShell(view, host, input).start();

// Online only: `?fake` plays against a stand-in, nothing worth counting.
if (online) {
  const tracker = new MetricsTracker({
    report,
    language: () => flow.language(),
    now: () => Date.now(),
    match: () => (lastMatch ? { stats: lastMatch.stats(), details: lastMatch.details() } : null),
    practice: () => (practice ? { result: practice.result(), missed: practice.missedWords() } : null),
    online: () => {
      const m = online.currentMatch();
      return m ? { matchId: m.matchId, lang: m.lang, rttMs: m.oneWaySeconds() * 2000 || null } : null;
    },
  });
  metrics = tracker;
  tracker.observe(flow.state());
  flow.onChange((state) => tracker.observe(state));
  addEventListener('pagehide', () => tracker.pageHidden());
}

// An Invite link (`#/m/<id>`) skips the menu. Clear it so a reload doesn't try to join again.
const invite = /^#\/m\/([a-z0-9]{3,32})$/.exec(location.hash);
if (invite) {
  history.replaceState(null, '', location.pathname + location.search);
  flow.joinInvite(invite[1]);
}

// The cost guardrails publish whether online play is resting; check on load and every 30 s.
if (online) {
  const servers = createServerStatus();
  const checkServers = async () => flow.setServersResting((await servers.check()) === 'resting');
  void checkServers();
  setInterval(() => void checkServers(), 30_000);
}

if (import.meta.env.DEV) {
  // For end-to-end checks and the console: drive the real flow without key presses.
  Object.assign(window, { flow, online, host });
  if (backend) installDevKeys(flow, backend, host);
}
