import * as THREE from 'three';
import type { StageTheme } from '../data/types';

export interface StagePalette {
  sky: number;
  horizon: number;
  haze: number;
  surface: number;
  foundation: number;
  edge: number;
  terrain: readonly [number, number, number];
  cloud: number;
  sun: number;
}

/** Each arena keeps its own material and atmosphere, with a clear fighting edge. */
export const STAGE_PALETTES: Record<StageTheme, StagePalette> = {
  rooftop: {
    sky: 0x152442, horizon: 0x638daa, haze: 0xc59b92,
    surface: 0x536985, foundation: 0x25384e, edge: 0x77dceb,
    terrain: [0x30445f, 0x3c5470, 0x506a82], cloud: 0x7c94aa, sun: 0xffdcb0,
  },
  cavern: {
    sky: 0x0a252c, horizon: 0x326c72, haze: 0x8db5a6,
    surface: 0x698779, foundation: 0x344e4d, edge: 0xb4e9a2,
    terrain: [0x21484e, 0x2a5a5b, 0x3b7070], cloud: 0x66938a, sun: 0xa4e8c6,
  },
  graveyard: {
    sky: 0x20213b, horizon: 0x68658c, haze: 0xbda8ba,
    surface: 0x77788d, foundation: 0x414052, edge: 0xcebbeb,
    terrain: [0x36344e, 0x48405e, 0x5a506c], cloud: 0x8b839e, sun: 0xf7ead2,
  },
  ghostship: {
    sky: 0x172c3d, horizon: 0x58838c, haze: 0xb1ccc4,
    surface: 0xa08c6e, foundation: 0x51463e, edge: 0xc7c8b1,
    terrain: [0x264d5b, 0x326471, 0x49808a], cloud: 0x7996a0, sun: 0xd6e8d7,
  },
  peak: {
    sky: 0x376796, horizon: 0xb4d4e3, haze: 0xf6e9ca,
    surface: 0xb8bca8, foundation: 0x64757e, edge: 0xeee9ce,
    terrain: [0x5c829c, 0x7c9cae, 0xa2bfce], cloud: 0xe3edf3, sun: 0xffe9b2,
  },
  finale: {
    sky: 0x241e47, horizon: 0x865c93, haze: 0xf0b89d,
    surface: 0x6b6387, foundation: 0x37334f, edge: 0xe9c983,
    terrain: [0x453658, 0x615071, 0x826789], cloud: 0xac8da9, sun: 0xffdda7,
  },
  volcano: {
    sky: 0x301f2b, horizon: 0x995c56, haze: 0xf0a56a,
    surface: 0x736163, foundation: 0x40363e, edge: 0xffb36c,
    terrain: [0x51313e, 0x6c4249, 0x885752], cloud: 0x936d6b, sun: 0xffcd7c,
  },
  ice: {
    sky: 0x20385f, horizon: 0x6ba9c2, haze: 0xd1e9dd,
    surface: 0xb1d4df, foundation: 0x4e859e, edge: 0xe5f8f5,
    terrain: [0x40758f, 0x6297aa, 0x8dbac7], cloud: 0xb1cfdf, sun: 0xecf3d9,
  },
};

const css = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/** Texture details share the existing platform draw calls and never touch the sim RNG. */
export function stageSurfaceTexture(theme: StageTheme, top: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  const finish = ctx.createLinearGradient(0, 0, 0, 128);
  finish.addColorStop(0, '#ffffff');
  finish.addColorStop(top ? 0.75 : 0.2, top ? '#e4e9ed' : '#edf0f2');
  finish.addColorStop(1, top ? '#d1d7de' : '#969faa');
  ctx.fillStyle = finish;
  ctx.fillRect(0, 0, 512, 128);

  const tech = theme === 'rooftop' || theme === 'finale';
  const timber = theme === 'ghostship';
  const rows = top ? 2 : timber ? 5 : 3;
  for (let row = 0; row < rows; row += 1) {
    const y = row * 128 / rows;
    ctx.fillStyle = tech ? '#5e6b78' : '#6a737c';
    ctx.globalAlpha = top ? 0.13 : 0.36;
    ctx.fillRect(0, y, 512, tech ? 2 : 1.4);
    for (let cell = 0; cell < (tech ? 6 : 8); cell += 1) {
      const x = cell * (tech ? 88 : 70) + (row % 2) * 32;
      ctx.fillRect(x, y, tech ? 2 : 1.5, 128 / rows);
      ctx.globalAlpha = top ? 0.18 : 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 3, y + 3, tech ? 65 : 46, 1);
      ctx.fillStyle = '#6a737c';
      ctx.globalAlpha = top ? 0.13 : 0.36;
    }
  }

  if (timber) {
    ctx.strokeStyle = '#756952';
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 20; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, i * 6.4);
      ctx.bezierCurveTo(160, i * 6.4 + 4, 300, i * 6.4 - 3, 512, i * 6.4 + 1);
      ctx.stroke();
    }
  } else if (theme === 'ice' || theme === 'volcano') {
    ctx.globalAlpha = theme === 'ice' ? 0.5 : 0.7;
    ctx.strokeStyle = theme === 'ice' ? '#e9ffff' : '#ffad74';
    ctx.lineWidth = theme === 'ice' ? 1 : 2;
    for (let i = 0; i < 7; i += 1) {
      const x = 18 + i * 77;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 19, 41);
      ctx.lineTo(x + 10, 61);
      ctx.lineTo(x + 36, 128);
      ctx.stroke();
    }
  }
  if (tech && !top) {
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = '#141e2c';
    for (let panel = 0; panel < 6; panel += 1) {
      for (let slot = 0; slot < 4; slot += 1) ctx.fillRect(panel * 88 + 16 + slot * 10, 67, 4, 17);
    }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

/** A flat top preserves the exact landing line; the lower corners catch light. */
export function stageSlabGeometry(width: number, thickness: number, depth: number): THREE.ExtrudeGeometry {
  const bevel = Math.min(0.24, thickness * 0.32);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, -thickness + bevel);
  shape.lineTo(width / 2 - bevel, -thickness);
  shape.lineTo(-width / 2 + bevel, -thickness);
  shape.lineTo(-width / 2, -thickness + bevel);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -depth / 2);
  const uv = geometry.getAttribute('uv');
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < uv.count; i += 1) {
    const facing = Math.abs(normals.getZ(i)) > 0.5;
    uv.setXY(i, positions.getX(i) / width + 0.5, facing
      ? positions.getY(i) / thickness + 1
      : positions.getZ(i) / depth + 0.5);
  }
  return geometry;
}

/** Three existing depth layers become a skyline, ridgeline, or open sea. */
export function stageTerrainGeometry(theme: StageTheme, layer: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.5, -3);
  const skyline = theme === 'rooftop' || theme === 'finale';
  const sea = theme === 'ghostship';
  const sections = skyline ? 18 : sea ? 32 : 12;
  let previousHeight = 0.55;
  for (let i = 0; i <= sections; i += 1) {
    const x = -1.5 + i * 3 / sections;
    const profile = ((i * 7 + layer * 11) % 13) / 13;
    const height = sea
      ? 0.54 + Math.sin(i * 0.78 + layer) * 0.055
      : 0.35 + profile * (skyline ? 0.88 : 0.9);
    if (skyline && i > 0) shape.lineTo(x, previousHeight);
    shape.lineTo(x, height);
    previousHeight = height;
  }
  shape.lineTo(1.5, -3);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function paintStageSky(ctx: CanvasRenderingContext2D, theme: StageTheme): void {
  const palette = STAGE_PALETTES[theme];
  const { width, height } = ctx.canvas;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, css(palette.sky));
  gradient.addColorStop(0.57, css(palette.horizon));
  gradient.addColorStop(1, css(palette.haze));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Broad atmosphere stays behind the small, high-contrast combat silhouettes.
  const glow = ctx.createRadialGradient(width * 0.73, height * 0.46, 0, width * 0.73, height * 0.46, width * 0.62);
  glow.addColorStop(0, `${css(palette.sun)}38`);
  glow.addColorStop(1, `${css(palette.sun)}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  if (theme === 'ice' || theme === 'finale') {
    ctx.save();
    ctx.globalAlpha = theme === 'ice' ? 0.14 : 0.08;
    ctx.strokeStyle = theme === 'ice' ? '#a2ffe6' : '#f5c2ec';
    ctx.lineWidth = width * 0.035;
    ctx.filter = 'blur(16px)';
    ctx.beginPath();
    ctx.moveTo(-width * 0.1, height * 0.42);
    ctx.bezierCurveTo(width * 0.35, height * 0.1, width * 0.65, height * 0.48, width * 1.1, height * 0.13);
    ctx.stroke();
    ctx.restore();
  }
  if (theme !== 'peak' && theme !== 'volcano' && theme !== 'cavern') {
    ctx.fillStyle = '#ecf3ff';
    for (let i = 0; i < 54; i += 1) {
      const x = ((i * 137 + 29) % width);
      const y = ((i * 61 + 11) % (height * 0.46));
      ctx.globalAlpha = 0.16 + (i % 4) * 0.09;
      ctx.fillRect(x, y, i % 5 === 0 ? 1.6 : 0.8, i % 5 === 0 ? 1.6 : 0.8);
    }
    ctx.globalAlpha = 1;
  }
}
