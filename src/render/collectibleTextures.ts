import * as THREE from 'three';

/** A canvas stamp shared by the visible faces of minted gold drops. */
export function coinStamp(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff5cc';
  ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#ae853f';
  ctx.beginPath();
  ctx.arc(64, 64, 51, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#b48b42';
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const angle = point * Math.PI / 5 - Math.PI / 2;
    const radius = point % 2 === 0 ? 31 : 15;
    const x = 64 + Math.cos(angle) * radius;
    const y = 64 + Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
