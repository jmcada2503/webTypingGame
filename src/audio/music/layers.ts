export type Layer = 'pad' | 'bass' | 'kick' | 'snare' | 'hats' | 'arp' | 'lead';
export const LAYERS: readonly Layer[] = ['pad', 'bass', 'kick', 'snare', 'hats', 'arp', 'lead'];

export interface LayerState {
  on: Record<Layer, boolean>;
  barsLow: Record<Layer, number>;
}

const each = <T>(f: (l: Layer) => T) => Object.fromEntries(LAYERS.map((l) => [l, f(l)])) as Record<Layer, T>;

export const startLayers = (): LayerState => ({ on: each(() => false), barsLow: each(() => 0) });
export const layersOn = (s: LayerState): Layer[] => LAYERS.filter((l) => s.on[l]);
/** The intensity at which each layer joins the Match music. */
export const THRESHOLD: Readonly<Record<Layer, number>> = { pad: 0, bass: 0.18, kick: 0.32, snare: 0.45, hats: 0.52, arp: 0.6, lead: 0.75 };
/** A layer leaves only this far under its threshold... */
const LEAVE_MARGIN = 0.06;
/** ...and after this many bar starts down there, so the music doesn't flicker. */
const LEAVE_BARS = 2;

/** One beat of the Match music at intensity `v`: layers join at once, leave only after holding low. */
export function stepLayers(s: LayerState, v: number, barStart: boolean): LayerState {
  const on = { ...s.on };
  const barsLow = { ...s.barsLow };
  for (const l of LAYERS) {
    if (v >= THRESHOLD[l]) {
      on[l] = true;
      barsLow[l] = 0;
    } else if (on[l] && v < THRESHOLD[l] - LEAVE_MARGIN && barStart && ++barsLow[l] >= LEAVE_BARS) on[l] = false;
  }
  return { on, barsLow };
}
