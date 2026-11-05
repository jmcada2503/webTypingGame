// The game: the screen flow, the screens, and the game scene, mounted by the app shell.
import './app/app.css';
import { AppShell } from './app/AppShell';
import { runSoundPrompt } from './app/runSoundPrompt';
import { AudioEngine } from './audio/AudioEngine';
import { toggleMute } from './audio/soundEditing';
import { loadSoundSettings, saveSoundSettings, type SoundSettings } from './audio/soundSettings';
import { MatchSounds } from './audio/matchSounds';
import { musicInputsOf } from './audio/music/intensity';
import type { MusicPlayer } from './audio/music/MusicPlayer';
import { endMoodOf, musicStateOf } from './audio/music/musicState';
import { screenCues, type CueMoment } from './audio/screenCues';
import { SOUNDS, type PlaySound } from './audio/sounds';
import { SCREEN_TRANSITION } from './render/ScreenFilters';
import { isFullscreen, isFullscreenKey } from './app/fullscreen';
import { isTouchOnly } from './app/keyboardGate';
import { runKeyboardGate } from './app/runKeyboardGate';
import { installDevKeys } from './dev/devKeys';
import { FakeBackend } from './flow/FakeNetwork';
import { ScreenFlow } from './flow/ScreenFlow';
import { KeyboardTypingInput } from './input/KeyboardTypingInput';
import { REMATCH_INDEX_STRIDE, createAttackWordSource } from './match/attackWords';
import { MATCH_FLIGHT, MatchEngine } from './match/MatchEngine';
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
import { SoundPanel } from './screens/soundPanel';
import { placeholderOnline } from './screens/content';
import { inviteCodeFromHash } from './app/inviteLink';
import { syncLanguageWithAddress } from './app/languageAddress';
import { opponentLeftScreen } from './screens/opponentLeftScreen';
import { simpleScreens } from './screens/simpleScreens';
import { waitingScreen } from './screens/waitingScreen';
import { AsciiGameView } from './view/AsciiGameView';
import { loadWordList } from './words/wordLists';

/** Diagnostics that are not metrics records (errors, version checks, each Shot-check detail): console only. */
const logMetric = (entry: Record<string, unknown>) => console.info(JSON.stringify(entry));

const safeStorage = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();

// The sound: made now (so we know whether the browser holds it), unlocked by the first key press or click.
let soundSettings = loadSoundSettings(safeStorage);
const sound = new AudioEngine({
  createContext: () => {
    // iPhone / iPad: respect the silent switch and mix with the player's own music.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
    return new AudioContext({ latencyHint: 'interactive' });
  },
  sounds: SOUNDS,
  settings: soundSettings,
});
sound.listen(window);
/** Every change to the sound settings: kept, saved for the next visit and heard at once. */
const changeSound = (next: SoundSettings) => {
  soundSettings = next;
  saveSoundSettings(safeStorage, next);
  sound.applySettings(next);
};

const view = await AsciiGameView.create();
// Phones and tablets without a mouse or trackpad get a "needs a physical keyboard" screen until a real key is pressed.
// That key press unlocks the sound too: let it start before checking whether the browser still holds it.
if (isTouchOnly(window)) {
  await runKeyboardGate(view);
  await sound.unlock();
}

// Word lists are small (about 50 KB each, compressed): load both before the first screen (meanwhile, the sound prompt).
const wordListsLoading = Promise.all([loadWordList('en'), loadWordList('es')]);
// The browser holds the audio until a key press: ask "play with sound?", the answer being that key press.
if (sound.blocked && !soundSettings.muted && (await runSoundPrompt(view, sound)) === 'silent') {
  changeSound({ ...soundSettings, muted: true });
}
const [en, es] = await wordListsLoading;
const wordLists = { en, es };
const versions = { en: listVersion(wordLists.en), es: listVersion(wordLists.es) };

const pid = playerId();
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
// / plays in English and /es/ in Spanish; Tab in the menu moves between the two addresses.
syncLanguageWithAddress(flow);

// Every open tab counts as online (menu, queue, Match); the menu and waiting screens show the count.
const presenceApi = online ? createPresenceApi(pid) : null;
const presence = presenceApi ? startPresence({ language: () => flow.language(), beat: presenceApi.beat, fetchOnline: presenceApi.online }) : null;
const onlineCounts = (t: number) => (presence ? (presence.counts() ?? { en: 0, es: 0, total: 0 }) : placeholderOnline(t));
const input = new KeyboardTypingInput();
const copyText = (s: string) => void navigator.clipboard?.writeText(s).catch(() => {});
const play: PlaySound = (id) => sound.play(id);
/** The picture is on: no screen-change effect is hiding it. */
const pictureOn = () => SCREEN_TRANSITION.level === 0;
// The approved designs replace the plain screens one by one; the rest stay plain until their prototypes are done.
// The sound settings panel on the menu: each change is saved and answered with a blip (key clicks row: through the key-click bus).
const soundPanel = new SoundPanel(
  () => soundSettings,
  (next, row) => {
    changeSound(next);
    sound.play(row === 'keyClicks' ? 'settingsKeyBlip' : 'settingsBlip');
  },
);
const screens = { ...simpleScreens(flow, () => practice?.result() ?? null, () => (lastMatch ? { stats: lastMatch.stats(), enemyDamage: lastMatch.state().enemyDamage } : null), { play, pictureOn }), menu: menuScreen(flow, copyText, onlineCounts, isFullscreen, { panel: soundPanel, settings: () => soundSettings }, play), howto: howtoScreen(flow, play), waiting: waitingScreen(flow, copyText, onlineCounts, play), countdown: countdownScreen(), opponentLeft: opponentLeftScreen(flow, play) };

/** The Match and Practice sounds: key presses (from the sessions), game events and PEACE IN ticks (from the host). */
const matchSounds = new MatchSounds(play as (id: string) => void);
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
  if (mode === 'practice') return (practice = new PracticeSession({ list: wordLists[flow.language()], onKey: matchSounds.key.bind(matchSounds) }));
  const opponent = online?.currentMatch();
  if (!opponent) {
    const attackWords = createAttackWordSource(Math.floor(Math.random() * 2 ** 32), wordLists[flow.language()]);
    return (lastMatch = new MatchSession(new MatchEngine({ mode, attackWords, bulletFlightSeconds: 8, shotFlightSeconds: 8, flightRamp: MATCH_FLIGHT, onKey: matchSounds.key.bind(matchSounds) })));
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
    flightRamp: MATCH_FLIGHT,
    onKey: matchSounds.key.bind(matchSounds),
  });
  return (lastMatch = new MatchSession(engine, opponent.transport));
};
const host = new ScreenHost(view, flow, screens, createMatch, matchSounds);
const shell = new AppShell(view, host, input);
// Screen sounds: screen changes, endings, Countdown, Rematch, link effects (the screens play their own key sounds).
const cueMoment = (): CueMoment => ({ flow: flow.state(), effect: { mode: SCREEN_TRANSITION.mode, level: SCREEN_TRANSITION.level } });
let lastCue = cueMoment();
shell.onFrame(() => {
  const now = cueMoment();
  const cues = screenCues(lastCue, now);
  cues.play.forEach(play);
  sound.setLoop('reconnecting', cues.reconnecting ? 1 : 0);
  lastCue = now;
});
// Adaptive music: Tone.js (big, its own chunk) loads once the audio runs, then follows the game every frame.
let music: MusicPlayer | null = null;
let musicLoading = false;
shell.onFrame((_events, dt) => {
  const ctx = sound.context;
  const out = sound.musicInput;
  if (!music && !musicLoading && ctx?.state === 'running' && out) {
    musicLoading = true;
    void import('./audio/music/MusicPlayer')
      .then((m) => (music = m.startMusic(ctx, out)))
      .catch((error) => logMetric({ event: 'music_load_failed', error: String(error) }));
  }
  if (!music) return;
  const s = flow.state();
  const mode = s.screen === 'match' ? s.mode : 'practice';
  music.update(dt, musicStateOf(s, host.screenShown), (matchTime) => musicInputsOf(host.state(), mode, matchTime), endMoodOf(s));
});
// The page's crawlable text (title, how to play) gives way to the game.
document.documentElement.classList.add('game-ready');
shell.start();
// F toggles fullscreen on every screen but the Match, where it is a letter being typed (Esc also leaves fullscreen).
window.addEventListener('keydown', (e) => {
  if (isFullscreenKey(e) && host.screenShown !== 'match') void shell.toggleFullscreen();
});
// M mutes on every screen but the Match (where it is a letter being typed), the sound settings panel included.
window.addEventListener('keydown', (e) => {
  if ((e.key !== 'm' && e.key !== 'M') || e.ctrlKey || e.metaKey || e.altKey || e.repeat || host.screenShown === 'match') return;
  changeSound(toggleMute(soundSettings));
  if (!soundSettings.muted) sound.play('settingsBlip');
});

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

// An Invite link (`#/m/<id>`) skips the menu, on load and also when it is entered in a page that is already open
// (that only changes the hash, it does not reload). Clear it so a reload doesn't try to join again.
const openInvite = () => {
  const code = inviteCodeFromHash(location.hash);
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  flow.joinInvite(code);
};
openInvite();
addEventListener('hashchange', openInvite);

// The cost guardrails publish whether online play is resting; check on load and every 30 s.
if (online) {
  const servers = createServerStatus();
  const checkServers = async () => flow.setServersResting((await servers.check()) === 'resting');
  void checkServers();
  setInterval(() => void checkServers(), 30_000);
}

if (import.meta.env.DEV) {
  // For end-to-end checks and the console: drive the real flow without key presses.
  Object.assign(window, { flow, online, host, sound });
  Object.defineProperty(window, 'music', { get: () => music });
  if (backend) installDevKeys(flow, backend, host);
}
