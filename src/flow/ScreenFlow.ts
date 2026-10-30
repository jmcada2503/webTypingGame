import { DEFAULT_FLOW_CONFIG, type FlowConfig, type FlowNetwork, type FlowState, type Language, type MatchKind, type MenuChoice, type NetworkEvent, type RematchState } from './types';

/** Floating-point slack when a timer is compared with zero. */
const EPS = 1e-9;

/**
 * Which screen the player is on, and how they move between screens: menu, how-to, waiting, Countdown, Match,
 * the end screens and Rematch. Pure logic: time moves only through `update(dt)`, the world arrives through
 * `FlowNetwork` events and the player's calls. It draws nothing.
 */
export class ScreenFlow {
  private readonly config: FlowConfig;
  private chosenLanguage: Language = 'en';
  /** The Rematch clocks are paused (an ending scene is playing). */
  private rematchHeld = false;
  private s: FlowState = { screen: 'menu', serversResting: false, language: 'en' };
  /** Seconds left in the current timed phase (connecting, starting gap). */
  private timer = 0;
  /** The kind of online match the player is in (remembered for the end screens). */
  private kind: MatchKind = 'public';
  /** Seconds the opponent's dropped connection has left to come back (null = connected). */
  private grace: number | null = null;
  /** The Invite code being joined (a guest); null when hosting or playing Public. */
  private joinCode: string | null = null;
  /** Servers resting: online matches are blocked. */
  private resting = false;

  constructor(
    private readonly network: FlowNetwork,
    config: Partial<FlowConfig> = {},
  ) {
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    network.onEvent((event) => this.onNetwork(event));
  }

  state(): FlowState {
    return { ...this.s };
  }

  /** The language the player chose (it drives the word list and who they are matched with). */
  language(): Language {
    return this.chosenLanguage;
  }

  setLanguage(language: Language) {
    this.chosenLanguage = language;
    if (this.s.screen === 'menu') this.s = { ...this.s, language };
  }

  /** The backend is shut off to stay in budget: online matches can't start. */
  setServersResting(resting: boolean) {
    this.resting = resting;
    const s = this.s;
    if (s.screen === 'menu') this.s = { ...s, serversResting: resting };
    else if (resting && (s.screen === 'howto' || (s.screen === 'waiting' && s.phase === 'searching'))) {
      if (s.screen === 'waiting') this.network.leave();
      this.toMenu();
    }
  }

  /** The player opened an Invite link: no menu, straight to the how-to. */
  joinInvite(code: string) {
    if (this.s.screen !== 'menu' || this.resting) return;
    this.joinCode = code;
    this.kind = 'private';
    this.s = { screen: 'howto', kind: 'private', secondsLeft: this.config.howToAutoStartSeconds };
  }

  /** The player picked a menu card. */
  choose(choice: MenuChoice) {
    if (this.s.screen !== 'menu') return;
    if (this.resting && choice !== 'practice') return;
    this.joinCode = null;
    if (choice === 'practice') return this.startPractice();
    this.kind = choice;
    this.s = { screen: 'howto', kind: choice, secondsLeft: this.config.howToAutoStartSeconds };
  }

  /** Enter. */
  confirm() {
    if (this.s.screen === 'howto') this.startWaiting(this.s.kind);
  }

  /** After an error or an end screen: look for a new opponent. */
  searchAgain() {
    const s = this.s;
    if ((s.screen === 'error' || s.screen === 'opponentLeft') && s.kind === 'public') this.startWaiting('public');
    if (s.screen === 'end' && s.mode === 'versus' && s.kind === 'public') {
      this.network.leave();
      this.startWaiting('public');
    }
  }

  /** Practice results: go again. */
  playAgain() {
    if (this.s.screen === 'end' && this.s.mode === 'practice') this.startPractice();
  }

  /** Back to the menu from an error or end screen. */
  backToMenu() {
    if (this.s.screen === 'end' && this.s.mode === 'versus') this.network.leave();
    if (this.s.screen === 'error' || this.s.screen === 'end' || this.s.screen === 'opponentLeft') this.toMenu();
  }

  /** The app reports that the running Match finished. */
  matchEnded(result: 'won' | 'lost' | 'peace') {
    if (this.s.screen !== 'match') return;
    this.rematchHeld = false;
    const mode = this.s.mode;
    if (mode === 'practice') this.s = { screen: 'end', mode, result: 'practiceOver' };
    else {
      const secondsLeft = this.kind === 'private' ? null : this.config.rematchWindowSeconds;
      this.s = { screen: 'end', mode, result, kind: this.kind, rematch: { status: 'available', secondsLeft } };
    }
  }

  /** On an online end screen: propose a Rematch (or accept, if the opponent already proposed). */
  proposeRematch() {
    const r = this.rematch();
    if (r?.status === 'available') {
      this.network.sendRematch('propose');
      this.setRematch({ status: 'waiting', answerSecondsLeft: this.config.rematchAnswerSeconds, secondsLeft: r.secondsLeft });
    } else if (r?.status === 'incoming') this.acceptRematch();
  }

  /** Take back my request while the opponent has not answered. */
  cancelRematch() {
    const r = this.rematch();
    if (r?.status !== 'waiting') return;
    this.network.sendRematch('cancel');
    this.setRematch(this.options(r.secondsLeft));
  }

  acceptRematch() {
    if (this.rematch()?.status !== 'incoming') return;
    this.network.sendRematch('accept');
    this.startCountdown('versus');
  }

  /** Deny the opponent's request: DECLINED for a moment, and in Public Rematch is then closed. */
  declineRematch() {
    const r = this.rematch();
    if (r?.status !== 'incoming') return;
    this.network.sendRematch('decline');
    this.setRematch(this.notice('declined', r.secondsLeft));
  }

  /** Q on the waiting screen. */
  cancel() {
    if (this.s.screen !== 'waiting') return;
    this.network.leave();
    this.toMenu();
  }

  /**
   * Pause (or resume) the Rematch clocks. The app holds them while an ending scene plays, so the window and the
   * answer times start counting when the end screen is actually up and the player can act.
   */
  holdRematch(held: boolean) {
    this.rematchHeld = held;
  }

  update(dt: number) {
    if (this.s.screen === 'howto') {
      const secondsLeft = this.s.secondsLeft - dt;
      if (secondsLeft <= 0) this.startWaiting(this.s.kind);
      else this.s = { ...this.s, secondsLeft };
    } else if (this.s.screen === 'waiting' && this.s.phase === 'connecting') {
      this.timer -= dt;
      if (this.timer <= EPS) {
        this.network.leave();
        this.s = { screen: 'error', reason: 'connectFailed', kind: this.s.kind };
      }
    } else if (this.s.screen === 'countdown') {
      const secondsLeft = this.s.secondsLeft - dt;
      if (secondsLeft <= EPS) {
        this.s = { screen: 'starting', mode: this.s.mode };
        this.timer = this.config.startingSeconds;
      } else this.s = { ...this.s, secondsLeft };
    } else if (this.s.screen === 'starting') {
      this.timer -= dt;
      if (this.timer <= EPS) this.s = { screen: 'match', mode: this.s.mode };
    } else if (this.s.screen === 'end' && this.s.mode === 'versus') {
      if (!this.rematchHeld) this.tickRematch(dt, this.s.rematch);
    } else if (this.s.screen === 'match' && this.grace !== null) {
      this.grace -= dt;
      if (this.grace <= EPS) this.opponentGone();
    }
  }

  // ---- internals ----

  /** The Rematch offer of the online end screen being shown, if any. */
  private rematch(): RematchState | undefined {
    return this.s.screen === 'end' && this.s.mode === 'versus' ? this.s.rematch : undefined;
  }

  /** The options after a Rematch moment: still available while the window lasts (or in Private), else closed. */
  private options(windowLeft: number | null): RematchState {
    return windowLeft !== null && windowLeft <= EPS ? { status: 'closed' } : { status: 'available', secondsLeft: windowLeft };
  }

  private notice(notice: 'noAnswer' | 'tooLate' | 'declined', windowLeft: number | null): RematchState {
    // In Public a deny closes Rematch for good; in Private it stays offered.
    return { status: 'notice', notice, noticeSecondsLeft: this.config.rematchNoticeSeconds, secondsLeft: windowLeft, closes: notice === 'declined' && this.kind === 'public' };
  }

  /** Time passes on the Rematch menu: the window counts down in the background, the answer time and notices too. */
  private tickRematch(dt: number, r: RematchState) {
    if (r.status === 'closed' || r.status === 'opponentLeft') return;
    const windowLeft = r.secondsLeft === null ? null : Math.max(0, r.secondsLeft - dt);
    if (r.status === 'available') return this.setRematch(this.options(windowLeft));
    if (r.status === 'notice') {
      const left = r.noticeSecondsLeft - dt;
      if (left > EPS) return this.setRematch({ ...r, noticeSecondsLeft: left, secondsLeft: windowLeft });
      return this.setRematch(r.closes ? { status: 'closed' } : this.options(windowLeft));
    }
    const answer = r.answerSecondsLeft - dt;
    if (answer > EPS) return this.setRematch({ ...r, answerSecondsLeft: answer, secondsLeft: windowLeft });
    this.setRematch(this.notice(r.status === 'waiting' ? 'noAnswer' : 'tooLate', windowLeft));
  }

  private setRematch(rematch: RematchState) {
    if (this.s.screen === 'end' && this.s.mode === 'versus') this.s = { ...this.s, rematch };
  }

  /** Practice has no opponent to wait for: no Countdown, just the screen-off / black / screen-on gap. */
  private startPractice() {
    this.s = { screen: 'starting', mode: 'practice' };
    this.timer = this.config.startingSeconds;
  }

  private startCountdown(mode: 'versus' | 'practice') {
    this.s = { screen: 'countdown', mode, secondsLeft: this.config.countdownSeconds };
  }

  private startWaiting(kind: MatchKind) {
    this.s = { screen: 'waiting', kind, phase: 'searching' };
    if (kind === 'public') this.network.joinQueue(this.chosenLanguage);
    else if (this.joinCode) this.network.joinPrivate(this.joinCode);
    else this.network.createPrivate(this.chosenLanguage);
  }

  private toMenu() {
    this.joinCode = null;
    this.s = { screen: 'menu', serversResting: this.resting, language: this.chosenLanguage };
  }

  /** The opponent is gone: where it happened decides the screen; leaving the Match is a win. */
  private opponentGone() {
    const s = this.s;
    const during = s.screen === 'waiting' ? 'waiting' : s.screen === 'match' ? 'match' : 'countdown';
    this.network.leave();
    this.grace = null;
    this.s = { screen: 'opponentLeft', during, youWin: during === 'match', kind: this.kind };
  }

  private onNetwork(event: NetworkEvent) {
    const s = this.s;
    const status = this.rematch()?.status;
    if (status !== undefined) {
      if (event.type === 'opponentLeft' || event.type === 'opponentDisconnected') {
        this.network.leave();
        return this.setRematch({ status: 'opponentLeft' });
      }
      if (event.type === 'rematch') {
        const r = this.rematch()!;
        if (event.message === 'propose' && r.status === 'waiting') return this.startCountdown('versus');
        if (event.message === 'propose' && r.status === 'available') return this.setRematch({ status: 'incoming', answerSecondsLeft: this.config.rematchAnswerSeconds, secondsLeft: r.secondsLeft });
        if (event.message === 'accept' && r.status === 'waiting') return this.startCountdown('versus');
        if (event.message === 'decline' && r.status === 'waiting') return this.setRematch(this.notice('declined', r.secondsLeft));
        if (event.message === 'cancel' && r.status === 'incoming') return this.setRematch(this.options(r.secondsLeft));
      }
      return;
    }
    if (event.type === 'opponentLeft' && ((s.screen === 'waiting' && s.phase === 'connecting') || s.screen === 'countdown' || s.screen === 'starting' || s.screen === 'match')) return this.opponentGone();
    if (event.type === 'opponentDisconnected') {
      if (s.screen === 'match') this.grace = this.config.disconnectGraceSeconds;
      else if ((s.screen === 'waiting' && s.phase === 'connecting') || s.screen === 'countdown' || s.screen === 'starting') return this.opponentGone();
    }
    if (event.type === 'opponentReconnected') this.grace = null;
    if (this.s.screen === 'waiting') {
      if (event.type === 'inviteCreated') this.s = { ...this.s, inviteLink: event.link };
      if (event.type === 'inviteInvalid') {
        this.s = { screen: 'error', reason: event.reason === 'full' ? 'inviteFull' : 'inviteExpired', kind: this.s.kind };
        return;
      }
      if (event.type === 'matched') {
        this.s = { ...this.s, phase: 'connecting' };
        this.timer = this.config.connectTimeoutSeconds;
      }
      if (event.type === 'connected') this.startCountdown('versus');
      if (event.type === 'connectFailed') {
        this.network.leave();
        this.s = { screen: 'error', reason: 'connectFailed', kind: this.s.kind };
      }
    }
  }
}
