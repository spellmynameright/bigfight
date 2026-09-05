import type { Box3, Vector3 } from 'three';

/** Fit the complete movement at the chosen viewing angle, including perspective depth. */
export function motionCameraFrame(bounds: Box3, center: Vector3, ground: number, yaw: number, aspect: number, fov: number): { targetY: number; distance: number; tilt: number } {
  const targetY = (bounds.min.y + bounds.max.y) / 2 - ground;
  const tilt = 0.07;
  const vertical = Math.tan(fov * Math.PI / 360);
  const horizontal = vertical * aspect;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);
  let distance = 0.1;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const rx = (x - center.x) * cos + (z - center.z) * sin;
    const rz = -(x - center.x) * sin + (z - center.z) * cos;
    const ry = y - ground - targetY;
    const up = ry * cosTilt - rz * sinTilt;
    const depth = ry * sinTilt + rz * cosTilt;
    distance = Math.max(distance, Math.abs(rx) * 1.14 / horizontal + depth, Math.abs(up) * 1.14 / vertical + depth);
  }
  return { targetY, distance, tilt };
}
