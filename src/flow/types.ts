export type Language = 'en' | 'es';
export type MatchKind = 'public' | 'private';
/** A Match against the opponent, or Practice alone. */
export type PlayMode = 'versus' | 'practice';

/** Which screen the player is on, plus what that screen needs to show. */
export type FlowState =
  | { screen: 'menu'; serversResting: boolean; language: Language }
  /** Before every Public / Private match. `secondsLeft` runs to the auto-start. */
  | { screen: 'howto'; kind: MatchKind; secondsLeft: number }
  /** Looking for an opponent (Public) or for a friend (Private, with the Invite link once it exists). */
  | { screen: 'waiting'; kind: MatchKind; phase: 'searching' | 'connecting'; inviteLink?: string }
  /** The big Countdown: input frozen until it ends. */
  | { screen: 'countdown'; mode: PlayMode; secondsLeft: number }
  /** The screen-off / black / screen-on gap: the Match begins only when it ends. */
  | { screen: 'starting'; mode: PlayMode }
  | { screen: 'match'; mode: PlayMode }
  /** Practice results. */
  | { screen: 'end'; mode: 'practice'; result: 'practiceOver' }
  /** After an online Match: how it ended and the state of the Rematch offer. */
  | { screen: 'end'; mode: 'versus'; result: 'won' | 'lost' | 'peace'; kind: MatchKind; rematch: RematchState }
  /** The opponent left during `during`; `youWin` only when it happened in the Match. */
  | { screen: 'opponentLeft'; during: 'waiting' | 'countdown' | 'match'; youWin: boolean; kind: MatchKind }
  | { screen: 'error'; reason: 'connectFailed' | 'inviteFull' | 'inviteExpired'; kind: MatchKind };

/**
 * The Rematch offer on an online end screen.
 * `available`: I can propose (`secondsLeft` runs out on Public; `null` = Private, always on).
 * `waiting`: I proposed. `incoming`: they proposed, I can accept or decline. `declined`: they said no.
 * `closed`: the window passed or I said no. `opponentLeft`: they are gone.
 */
export type RematchState =
  | { status: 'available'; secondsLeft: number | null }
  | { status: 'waiting' }
  | { status: 'incoming' }
  | { status: 'declined' }
  | { status: 'closed' }
  | { status: 'opponentLeft' };

/** What the player asked for (Enter, Q, menu choices...). The app turns keys into these calls. */
export type MenuChoice = 'practice' | MatchKind;

/** What the matchmaking service and the P2P channel tell the flow. */
export type NetworkEvent =
  | { type: 'inviteCreated'; link: string }
  /** The Invite link can't be used: the match already has two players, or the host is gone. */
  | { type: 'inviteInvalid'; reason: 'full' | 'expired' }
  /** An opponent was found; the two clients now connect to each other. */
  | { type: 'matched' }
  /** Both connections are confirmed. */
  | { type: 'connected' }
  /** The opponent's connection dropped; in a Match they get a short grace to come back. */
  | { type: 'opponentDisconnected' }
  | { type: 'opponentReconnected' }
  /** The opponent is gone for good (closed the tab, left). */
  | { type: 'opponentLeft' }
  /** The opponent's answer to, or offer of, a Rematch. */
  | { type: 'rematch'; message: 'propose' | 'accept' | 'decline' };

/** The line to matchmaking and to the opponent. The real one is Lambda + WebRTC; tests use fakes. */
export interface FlowNetwork {
  joinQueue(language: Language): void;
  createPrivate(language: Language): void;
  joinPrivate(code: string): void;
  /** Leave the queue or the Private match quietly. */
  leave(): void;
  sendRematch(message: 'propose' | 'accept' | 'decline'): void;
  onEvent(cb: (event: NetworkEvent) => void): () => void;
}

/** Every length of time in the flow, in seconds. */
export interface FlowConfig {
  howToAutoStartSeconds: number;
  countdownSeconds: number;
  /** The screen-off / black / screen-on gap between the Countdown and the Match. */
  startingSeconds: number;
  connectTimeoutSeconds: number;
  disconnectGraceSeconds: number;
  rematchWindowSeconds: number;
}

export const DEFAULT_FLOW_CONFIG: FlowConfig = {
  howToAutoStartSeconds: 30,
  countdownSeconds: 5,
  startingSeconds: 1.8,
  connectTimeoutSeconds: 10,
  disconnectGraceSeconds: 5,
  rematchWindowSeconds: 10,
};
