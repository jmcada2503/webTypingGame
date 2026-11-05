// Tests only: a stand-in for the browser's AudioContext that records what reaches the speakers.

class FakeParam {
  constructor(public value: number) {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect<T extends FakeNode>(node: T): T {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs.length = 0;
  }
  /** How loud this node is at the speakers (1 = full). */
  level(): number {
    return this.outputs.reduce((sum, n) => sum + n.level(), 0);
  }
}

class FakeDestination extends FakeNode {
  level() {
    return 1;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  level() {
    return this.gain.value * super.level();
  }
}

class FakeBuffer {
  readonly data: Float32Array;
  constructor(length: number) {
    this.data = new Float32Array(length);
  }
  getChannelData() {
    return this.data;
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  constructor(private ctx: FakeAudioContext) {
    super();
  }
  start() {
    this.started = true;
    this.ctx.sources.push(this);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.onended?.();
  }
}

/** One sound reaching the speakers: `sound` is the first sample of its buffer (tests mark each sound with one). */
export interface Heard {
  sound: number;
  rate: number;
  level: number;
  loop: boolean;
}

export class FakeAudioContext {
  state: string;
  currentTime = 0;
  readonly destination = new FakeDestination();
  readonly sources: FakeSource[] = [];
  resumes = 0;
  /** Whether the browser lets `resume()` start the audio (it does inside a key press). */
  allowResume = true;

  constructor(state: 'running' | 'suspended' = 'suspended') {
    this.state = state;
  }
  resume() {
    this.resumes++;
    if (this.allowResume) this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return new FakeGain();
  }
  createBuffer(_channels: number, length: number) {
    return new FakeBuffer(length);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  /** What is playing now, and how loud. */
  heard(): Heard[] {
    return this.sources.filter((s) => !s.stopped).map((s) => ({ sound: s.buffer!.data[0], rate: s.playbackRate.value, level: s.level(), loop: s.loop }));
  }
}
