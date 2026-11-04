// PROTOTYPE (sound style, throwaway): the sound event catalog (from the closed "Sound event catalog" grilling ticket).

export type Polarity = 'good' | 'bad' | 'neutral';

export const SOUNDS = [
  // Typing
  { id: 'keyMatch', label: 'letter, matching', group: 'Typing', pol: 'good' },
  { id: 'keyNoMatch', label: 'letter, no match', group: 'Typing', pol: 'bad' },
  { id: 'keyBackspace', label: 'Backspace', group: 'Typing', pol: 'neutral' },
  { id: 'wrongSubmit', label: 'wrong submit', group: 'Typing', pol: 'bad' },
  // Threat and Lives
  { id: 'enemyFired', label: 'enemy fired', group: 'Threat', pol: 'bad' },
  { id: 'closeWarning', label: 'close warning', group: 'Threat', pol: 'bad' },
  { id: 'lifeLost', label: 'Life lost', group: 'Threat', pol: 'bad' },
  { id: 'lastLife', label: 'last Life alarm', group: 'Threat', pol: 'bad' },
  { id: 'damageHum', label: 'damage hum (loop, nice)', group: 'Threat', pol: 'bad', loop: true },
  // Combat
  { id: 'wordBulletDestroyed', label: 'Word bullet destroyed', group: 'Combat', pol: 'good' },
  { id: 'attackFired', label: 'Attack word fired', group: 'Combat', pol: 'good' },
  { id: 'shotHit', label: 'Shot hits Enemy ship', group: 'Combat', pol: 'good' },
  { id: 'shotDefended', label: 'Shot defended by enemy', group: 'Combat', pol: 'bad' },
  // Idle
  { id: 'idleNudge', label: 'Idle nudge (nice)', group: 'Idle', pol: 'neutral' },
  { id: 'peaceTick', label: 'PEACE IN tick', group: 'Idle', pol: 'neutral' },
  // Screens
  { id: 'menuMove', label: 'menu move', group: 'Screens', pol: 'neutral' },
  { id: 'menuConfirm', label: 'confirm', group: 'Screens', pol: 'neutral' },
  { id: 'menuBack', label: 'back / cancel', group: 'Screens', pol: 'neutral' },
  { id: 'sponsor', label: 'Sponsor', group: 'Screens', pol: 'neutral' },
  { id: 'copyLink', label: 'copy Invite link', group: 'Screens', pol: 'neutral' },
  { id: 'language', label: 'Tab language (nice)', group: 'Screens', pol: 'neutral' },
  { id: 'glitch', label: 'glitch transition', group: 'Screens', pol: 'neutral' },
  { id: 'tvOff', label: 'TV off', group: 'Screens', pol: 'neutral' },
  { id: 'tvOn', label: 'TV on', group: 'Screens', pol: 'neutral' },
  { id: 'opponentFound', label: 'opponent found', group: 'Screens', pol: 'neutral' },
  { id: 'countdownTick', label: 'Countdown tick', group: 'Screens', pol: 'neutral' },
  { id: 'go', label: 'GO', group: 'Screens', pol: 'neutral' },
  { id: 'scoreTick', label: 'score count-up tick', group: 'Screens', pol: 'neutral' },
  { id: 'newBest', label: 'NEW BEST', group: 'Screens', pol: 'good' },
  { id: 'rematchProposed', label: 'Rematch proposed', group: 'Screens', pol: 'neutral' },
  { id: 'rematchAccepted', label: 'Rematch accepted', group: 'Screens', pol: 'good' },
  { id: 'rematchDeclined', label: 'Rematch declined', group: 'Screens', pol: 'bad' },
  { id: 'opponentLeftWin', label: 'Opponent left (you win)', group: 'Screens', pol: 'good' },
  { id: 'errorSting', label: 'error / resting / left (nice)', group: 'Screens', pol: 'neutral' },
  // Endings
  { id: 'winEnding', label: 'Win ending', group: 'Endings', pol: 'good' },
  { id: 'loseEnding', label: 'Lose ending', group: 'Endings', pol: 'bad' },
  { id: 'peaceEnding', label: 'Peace ending', group: 'Endings', pol: 'neutral' },
  // Link effects
  { id: 'signalLost', label: 'signal lost', group: 'Link', pol: 'bad' },
  { id: 'reconnecting', label: 'RECONNECTING (loop)', group: 'Link', pol: 'bad', loop: true },
  { id: 'enemyBack', label: 'ENEMY BACK', group: 'Link', pol: 'good' },
  { id: 'resumeTick', label: 'resume tick', group: 'Link', pol: 'neutral' },
] as const satisfies readonly { id: string; label: string; group: string; pol: Polarity; loop?: boolean }[];

export type SoundId = (typeof SOUNDS)[number]['id'];

/** One sound style: every catalog sound, rendered as one buffer or several variants (picked at random per play). */
export interface SoundStyle {
  key: string;
  name: string;
  idea: string;
  sounds: Record<SoundId, () => Float32Array | Float32Array[]>;
}
