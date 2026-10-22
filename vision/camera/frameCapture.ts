import { VISION_CONFIG } from '../config';
import type { CapturedFrame } from '../types';

export class FrameCapture {
  private canvas: HTMLCanvasElement | null = null;

  async capture(video: HTMLVideoElement): Promise<CapturedFrame | null> {
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return null;
    }

    const canvas = this.getCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', VISION_CONFIG.camera.jpegQuality);
    });
    if (!blob) return null;

    return {
      blob,
      timestamp: Date.now(),
      width: canvas.width,
      height: canvas.height,
    };
  }

  dispose(): void {
    this.canvas = null;
  }

  private getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
    }
    return this.canvas;
  }
}
