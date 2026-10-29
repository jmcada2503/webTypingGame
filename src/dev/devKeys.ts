import type { FakeBackend, FakeEndpoint } from '../flow/FakeNetwork';
import type { ScreenFlow } from '../flow/ScreenFlow';
import type { ScreenHost } from '../screens/ScreenHost';

export const DEV_KEYS_HINT = 'DEV  CTRL+F OPPONENT FOUND  CTRL+E LOSE  CTRL+V WIN  CTRL+P PEACE  CTRL+D OPPONENT LEAVES  CTRL+M / CTRL+A / CTRL+X REMATCH PROPOSE / ACCEPT / DECLINE  CTRL+R SERVERS RESTING';

/**
 * Developer-only stand-ins for the things a real opponent and the real network would do, so the whole flow can
 * be walked alone with the fake network. Held on Ctrl so they never clash with the game's own keys; the browser's
 * own meaning for these (find, reload, bookmark...) is blocked while they are handled.
 */
const DEV_CODES = new Set(['KeyF', 'KeyE', 'KeyV', 'KeyP', 'KeyD', 'KeyM', 'KeyA', 'KeyX', 'KeyR']);

export function installDevKeys(flow: ScreenFlow, backend: FakeBackend, host: ScreenHost) {
  let bot: FakeEndpoint | null = null;
  let resting = false;
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    if (!DEV_CODES.has(e.code)) return;
    e.preventDefault();
    const s = flow.state();
    switch (e.code) {
      case 'KeyF': // an opponent shows up
        if (s.screen !== 'waiting' || s.phase !== 'searching') return;
        bot = backend.connect();
        if (s.kind === 'public') bot.joinQueue('en');
        else if (s.inviteLink) bot.joinPrivate(s.inviteLink.split('/m/')[1]);
        break;
      case 'KeyE':
        host.endMatch('lost');
        break;
      case 'KeyV':
        host.endMatch('won');
        break;
      case 'KeyP':
        host.endMatch('peace');
        break;
      case 'KeyD':
        bot?.leave();
        break;
      case 'KeyM':
        bot?.sendRematch('propose');
        break;
      case 'KeyA':
        bot?.sendRematch('accept');
        break;
      case 'KeyX':
        bot?.sendRematch('decline');
        break;
      case 'KeyR':
        resting = !resting;
        flow.setServersResting(resting);
        break;
    }
  });
}
