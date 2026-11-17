/** Canvas 2D stand-in that records strokes, joint dots, and clip rects. */
export function recordingContext(width = 100, height = 100) {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  const clips: Array<{ x: number; y: number; width: number; height: number }> = [];
  let cursor = { x: 0, y: 0 };
  const ctx = {
    canvas: { width, height },
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    beginPath() {},
    save() {},
    restore() {},
    rect(x: number, y: number, w: number, h: number) {
      clips.push({ x, y, width: w, height: h });
    },
    clip() {},
    setLineDash() {},
    measureText: () => ({ width: 10 }),
    roundRect() {},
    fillText() {},
    moveTo(x: number, y: number) {
      cursor = { x, y };
    },
    lineTo(x: number, y: number) {
      lines.push({ x1: cursor.x, y1: cursor.y, x2: x, y2: y });
    },
    stroke() {},
    arc(x: number, y: number, radius: number) {
      arcs.push({ x, y, radius });
    },
    fill() {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, lines, arcs, clips };
}
