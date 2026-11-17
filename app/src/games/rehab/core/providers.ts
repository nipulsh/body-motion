import type { PoseLandmark, PoseResult } from '@vision';
import { DEFAULT_MOCK_PARAMS, mockPose, type MockParams } from '@vision/games/rehab/core/mockSkeleton';

export type PoseCallback = (pose: PoseResult | null) => void;

export interface PoseProvider {
  start(): void;
  stop(): void;
  onFrame(cb: PoseCallback): () => void;
}

/** Synthetic skeleton at a fixed frame rate, driven by sliders and game demos. */
export class MockPoseProvider implements PoseProvider {
  params: MockParams = { ...DEFAULT_MOCK_PARAMS };
  /** Called every tick before the pose is built; return changes for a scripted demo. */
  demo: ((t: number, params: MockParams) => Partial<MockParams> | null) | null = null;
  private timer: number | null = null;
  private readonly listeners = new Set<PoseCallback>();
  private readonly t0 = performance.now();

  constructor(private readonly fps = 30) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      const t = (performance.now() - this.t0) / 1000;
      const d = this.demo?.(t, this.params);
      const params = d ? { ...this.params, ...d } : this.params;
      const pose = mockPose(params, t);
      if (pose) pose.timestamp = performance.now();
      for (const cb of this.listeners) cb(pose);
    }, 1000 / this.fps);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  onFrame(cb: PoseCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

interface WireLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface WireFrame {
  t?: number;
  aspect?: number;
  people?: Array<{ landmarks?: WireLandmark[]; worldLandmarks?: WireLandmark[] }>;
}

function toLandmarks(list: WireLandmark[] | undefined): PoseLandmark[] | null {
  if (!Array.isArray(list) || list.length < 33) return null;
  const out: PoseLandmark[] = [];
  for (const l of list.slice(0, 33)) {
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
    out.push({ x: l.x, y: l.y, z: Number.isFinite(l.z) ? (l.z as number) : 0, visibility: Number.isFinite(l.visibility) ? (l.visibility as number) : 1 });
  }
  return out;
}

/**
 * Reads PoseFrame JSON from external pose software:
 * `{ t, aspect?, people: [{ landmarks: 33×{x,y,z,visibility}, worldLandmarks }] }`.
 * The first person is used (the tracker then locks onto one person).
 */
export class WebSocketPoseProvider implements PoseProvider {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<PoseCallback>();
  private retry: number | null = null;
  private stopped = true;
  status: 'connecting' | 'open' | 'closed' = 'closed';

  constructor(private readonly url = 'ws://localhost:8765') {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'open';
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > 200_000) return;
      let frame: WireFrame;
      try {
        frame = JSON.parse(ev.data) as WireFrame;
      } catch {
        return;
      }
      const person = frame.people?.[0];
      const landmarks = toLandmarks(person?.landmarks);
      const pose: PoseResult | null = landmarks
        ? {
            landmarks,
            worldLandmarks: toLandmarks(person?.worldLandmarks) ?? undefined,
            confidence: 1,
            timestamp: performance.now(),
            frameAspect: Number.isFinite(frame.aspect) && (frame.aspect as number) > 0 ? frame.aspect : 16 / 9,
          }
        : null;
      for (const cb of this.listeners) cb(pose);
    };
    ws.onclose = () => {
      this.status = 'closed';
      for (const cb of this.listeners) cb(null);
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retry !== null) return;
    this.retry = window.setTimeout(() => {
      this.retry = null;
      this.connect();
    }, 2000);
  }

  stop(): void {
    this.stopped = true;
    if (this.retry !== null) window.clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close();
    this.ws = null;
  }

  onFrame(cb: PoseCallback): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
