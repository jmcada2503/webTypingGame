// The game: the screen flow, the screens, and the game scene, mounted by the app shell.
import './app/app.css';
import { AppShell } from './app/AppShell';
import { installDevKeys } from './dev/devKeys';
import { FakeBackend } from './flow/FakeNetwork';
import { ScreenFlow } from './flow/ScreenFlow';
import { KeyboardTypingInput } from './input/KeyboardTypingInput';
import { ScreenHost } from './screens/ScreenHost';
import { howtoScreen } from './screens/howtoScreen';
import { menuScreen } from './screens/menuScreen';
import { simpleScreens } from './screens/simpleScreens';
import { waitingScreen } from './screens/waitingScreen';
import { AsciiGameView } from './view/AsciiGameView';

// Until the real network exists, matchmaking and the opponent are the in-memory fake.
const backend = new FakeBackend();
const flow = new ScreenFlow(backend.connect());
const view = await AsciiGameView.create();
const input = new KeyboardTypingInput();
const copyText = (s: string) => void navigator.clipboard?.writeText(s).catch(() => {});
// The approved designs replace the plain screens one by one; the rest stay plain until their prototypes are done.
const screens = { ...simpleScreens(flow), menu: menuScreen(flow, copyText), howto: howtoScreen(flow), waiting: waitingScreen(flow, copyText) };
const host = new ScreenHost(view, flow, screens);
new AppShell(view, host, input).start();
if (import.meta.env.DEV) installDevKeys(flow, backend);
