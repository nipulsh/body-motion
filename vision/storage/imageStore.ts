import type { CapturedScanImage } from '../types';

export class ImageStore {
  private images: CapturedScanImage[] = [];
  private objectUrls: string[] = [];

  add(image: CapturedScanImage): void {
    this.images.push(image);
  }

  getAll(): CapturedScanImage[] {
    return [...this.images];
  }

  count(): number {
    return this.images.length;
  }

  averageQuality(): number {
    if (this.images.length === 0) return 0;
    const sum = this.images.reduce((acc, img) => acc + img.quality, 0);
    return sum / this.images.length;
  }

  rememberUrl(url: string): void {
    this.objectUrls.push(url);
  }

  clear(): void {
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls = [];
    this.images = [];
  }
}
