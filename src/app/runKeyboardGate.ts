import { drawNoKeyboard } from '../screens/noKeyboardScreen';
import type { GameView } from '../view/GameView';
import { runGateScreen } from './runGateScreen';

/** Show the "needs a physical keyboard" screen on `view` until a real key is pressed. */
export const runKeyboardGate = (view: GameView) => runGateScreen(view, drawNoKeyboard, () => true);
