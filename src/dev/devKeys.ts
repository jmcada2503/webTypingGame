import type { FakeBackend, FakeEndpoint } from '../flow/FakeNetwork';
import type { ScreenFlow } from '../flow/ScreenFlow';

export const DEV_KEYS_HINT = 'DEV  ALT+F OPPONENT FOUND  ALT+E LOSE  ALT+V WIN  ALT+D OPPONENT LEAVES  ALT+M / ALT+A / ALT+X REMATCH PROPOSE / ACCEPT / DECLINE  ALT+R SERVERS RESTING';

/**
 * Developer-only stand-ins for the things a real opponent and the real network would do, so the whole flow can
 * be walked alone with the fake network. Held on Alt so they never clash with the game's own keys.
 */
export function installDevKeys(flow: ScreenFlow, backend: FakeBackend) {
  let bot: FakeEndpoint | null = null;
  let resting = false;
  window.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const s = flow.state();
    switch (e.code) {
      case 'KeyF': // an opponent shows up
        if (s.screen !== 'waiting' || s.phase !== 'searching') return;
        bot = backend.connect();
        if (s.kind === 'public') bot.joinQueue('en');
        else if (s.inviteLink) bot.joinPrivate(s.inviteLink.split('/m/')[1]);
        break;
      case 'KeyE':
        flow.matchEnded('lost');
        break;
      case 'KeyV':
        flow.matchEnded('won');
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
