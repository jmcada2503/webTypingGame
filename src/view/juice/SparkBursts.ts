import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';

const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
const GLYPHS = '*+.';
const BIG_GLYPHS = '@#*+.';

type Spark = { col: number; row: number; vc: number; vr: number; age: number; life: number; color: PaletteColor; big: boolean };

/**
 * Small bursts of spark glyphs in the grid (e.g. yellow firing sparks). Sparks fly out from a grid
 * point and age through `* + .` before they go. Grid text: always behind every Word bullet.
 */
export class SparkBursts {
  private sparks: Spark[] = [];

  /**
   * Burst at a grid position. `reach` = how far sparks fly (grid rows); `spread` limits the
   * directions to a fan (radians, around `aim`, 0 = right, π/2 = up); omit for a full ring.
   */
  burst(
    col: number,
    row: number,
    opts: { count?: number; reach?: number; life?: number; color?: PaletteColor; aim?: number; spread?: number; big?: boolean } = {},
  ) {
    const { count = 10, reach = 3, life = 0.35, color = 'yellow', aim = Math.PI / 2, spread = Math.PI, big = false } = opts;
    for (let i = 0; i < count; i++) {
      const a = spread >= Math.PI ? (i / count) * Math.PI * 2 + Math.random() * 0.4 : aim + (Math.random() * 2 - 1) * spread;
      const speed = (reach / life) * (0.6 + Math.random() * 0.6);
      this.sparks.push({ col, row, vc: Math.cos(a) * speed * CELL_ASPECT, vr: -Math.sin(a) * speed, age: 0, life, color, big });
    }
  }

  update(dt: number, text: TextGrid) {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.col += s.vc * dt;
      s.row += s.vr * dt;
      const k = s.age / s.life;
      const glyphs = s.big ? BIG_GLYPHS : GLYPHS;
      const c = Math.floor(s.col);
      const r = Math.floor(s.row);
      text.write(c, r, glyphs[Math.min(glyphs.length - 1, Math.floor(k * glyphs.length))], s.color);
      if (s.big && k < 0.5) {
        // Big sparks are a small cross of cells while fresh.
        text.write(c - 1, r, '+', s.color);
        text.write(c + 1, r, '+', s.color);
        text.write(c, r - 1, '+', s.color);
      }
    }
  }
}
