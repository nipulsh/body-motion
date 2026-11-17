import * as THREE from 'three';
import type { ImageBounds, P2, Side } from '@vision/games/rehab/core/geometry';
import type { BasePose } from '@vision/games/rehab/core/types';
import type { Alignment } from './settings';

/**
 * Image space (camera, not mirrored) → screen and world.
 *
 * The camera picture is mirrored so the patient's left shows on the screen's
 * left like the reflection, fitted to the screen height, then the saved
 * alignment offset and scale move it onto the reflection. The Three.js world
 * is the z = 0 plane in front of a perspective camera, with one world unit
 * equal to the patient's leg length.
 */
export class DisplayMapper {
  width = 1;
  height = 1;
  aspect = 16 / 9;
  legLength = 0.42;
  alignment: Alignment = { offsetX: 0, offsetY: 0, scale: 1 };

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  /** Screen pixels per image unit. */
  get pxPerUnit(): number {
    return this.height * this.alignment.scale;
  }

  /** Screen pixels per world unit (one leg length). */
  get pxPerWorld(): number {
    return this.legLength * this.pxPerUnit;
  }

  toScreen(p: P2): { x: number; y: number } {
    const k = this.pxPerUnit;
    return {
      x: this.width / 2 + this.alignment.offsetX * this.height + (this.aspect / 2 - p.x) * k,
      y: this.height / 2 + this.alignment.offsetY * this.height + (p.y - 0.5) * k,
    };
  }

  /**
   * The part of the camera picture the screen shows, in image units. On the portrait
   * screen this is the full height but only a slice of a wide picture's width.
   */
  visibleImageBounds(): ImageBounds {
    const k = this.pxPerUnit;
    const shiftX = this.alignment.offsetX * this.height;
    const shiftY = this.alignment.offsetY * this.height;
    return {
      // Mirrored: the screen's left edge is the largest image x.
      minX: this.aspect / 2 - (this.width / 2 - shiftX) / k,
      maxX: this.aspect / 2 + (this.width / 2 + shiftX) / k,
      minY: 0.5 - (this.height / 2 + shiftY) / k,
      maxY: 0.5 + (this.height / 2 - shiftY) / k,
    };
  }

  screenToWorld(sx: number, sy: number, z = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const w = this.pxPerWorld;
    return out.set((sx - this.width / 2) / w, (this.height / 2 - sy) / w, z);
  }

  toWorld(p: P2, z = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.toScreen(p);
    return this.screenToWorld(s.x, s.y, z, out);
  }

  /** An image-space length in world units. */
  len(imageLength: number): number {
    return imageLength / this.legLength;
  }

  /** World y of the base floor line under one foot. */
  floorY(base: BasePose, side: Side): number {
    return this.toWorld({ x: base.ankleX[side], y: base.floorY[side] }).y;
  }

  /** World units visible vertically on the z = 0 plane. */
  get visibleWorldHeight(): number {
    return this.height / this.pxPerWorld;
  }

  /** Camera distance so the z = 0 plane fills the screen at the given field of view. */
  cameraDistance(fovDeg: number): number {
    return this.visibleWorldHeight / 2 / Math.tan((fovDeg * Math.PI) / 360);
  }
}
