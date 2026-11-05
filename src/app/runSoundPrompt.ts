import type { AudioEngine } from '../audio/AudioEngine';
import type { SoundId } from '../audio/sounds';
import { soundPrompt, type SoundChoice } from '../screens/soundPromptScreen';
import type { GameView } from '../view/GameView';
import { runGateScreen } from './runGateScreen';

/** Ask "play with sound?" until answered; with sound, the answering key unlocks the audio and a chime confirms. */
export async function runSoundPrompt(view: GameView, sound: AudioEngine<AudioContext, SoundId>): Promise<SoundChoice> {
  const prompt = soundPrompt();
  let choice: SoundChoice | null = null;
  await runGateScreen(view, prompt.draw, (e) => (choice = prompt.onKey(e)) !== null);
  if (choice === 'sound' && (await sound.unlock())) sound.play('menuConfirm');
  return choice!;
}
