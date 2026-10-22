export interface MirrorModelControl {
  /** Slide the model with the hand. dx/dy are viewport pixels, right and down positive. */
  panBy(dx: number, dy: number): void;
  /** factor > 1 moves the camera closer. factor < 1 moves it away. */
  zoomBy(factor: number): void;
}

let current: MirrorModelControl | null = null;

export function registerMirrorModelControl(control: MirrorModelControl): () => void {
  current = control;
  return () => {
    if (current === control) current = null;
  };
}

export function getMirrorModelControl(): MirrorModelControl | null {
  return current;
}
