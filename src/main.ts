// The game: the screen flow, the screens, and the game scene, mounted by the app shell.
import './app/app.css';
import { AppShell } from './app/AppShell';
import { installDevKeys } from './dev/devKeys';
import { FakeBackend } from './flow/FakeNetwork';
import { ScreenFlow } from './flow/ScreenFlow';
import { KeyboardTypingInput } from './input/KeyboardTypingInput';
import { createAttackWordSource } from './match/attackWords';
import { MatchEngine } from './match/MatchEngine';
import { MatchSession } from './match/MatchSession';
import { ScreenHost } from './screens/ScreenHost';
import { howtoScreen } from './screens/howtoScreen';
import { countdownScreen } from './screens/countdownScreen';
import { menuScreen } from './screens/menuScreen';
import { simpleScreens } from './screens/simpleScreens';
import { waitingScreen } from './screens/waitingScreen';
import { AsciiGameView } from './view/AsciiGameView';
import { loadWordList } from './words/wordLists';

// Until the real network exists, matchmaking and the opponent are the in-memory fake.
const backend = new FakeBackend();
const flow = new ScreenFlow(backend.connect());
const view = await AsciiGameView.create();
const input = new KeyboardTypingInput();
const copyText = (s: string) => void navigator.clipboard?.writeText(s).catch(() => {});
// The approved designs replace the plain screens one by one; the rest stay plain until their prototypes are done.
const screens = { ...simpleScreens(flow), menu: menuScreen(flow, copyText), howto: howtoScreen(flow), waiting: waitingScreen(flow, copyText), countdown: countdownScreen() };

// Word lists are small (about 50 KB each, compressed): load both before the first screen.
const wordLists = { en: await loadWordList('en'), es: await loadWordList('es') };

/**
 * What runs on the Match screen. Online: the Match engine with seeded Attack words (the seed comes from the
 * server once the real network exists; for now a local one) and no transport yet, so the opponent never answers.
 * Practice: TODO wire `PracticeSession` here once it is merged; until then Practice shows the idle game scene.
 */
const createMatch = (mode: 'versus' | 'practice') => {
  const list = wordLists[flow.language()];
  const attackWords = createAttackWordSource(Math.floor(Math.random() * 2 ** 32), list);
  return new MatchSession(new MatchEngine({ mode, attackWords, bulletFlightSeconds: 8, shotFlightSeconds: 8 }));
};
const host = new ScreenHost(view, flow, screens, createMatch);
new AppShell(view, host, input).start();
if (import.meta.env.DEV) installDevKeys(flow, backend);
