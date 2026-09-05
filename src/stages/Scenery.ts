import * as THREE from 'three';
import type { StageTheme } from '../data/types';

/** Two plates per environment; Eagle Peak reuses its three approved layers. */
const LAYERS: Record<StageTheme, readonly string[]> = {
  rooftop: ['far', 'near'], cavern: ['far', 'near'], graveyard: ['far', 'near'],
  ghostship: ['far', 'near'], peak: ['far', 'mid', 'near'], finale: ['far', 'near'],
  volcano: ['far', 'near'], ice: ['far', 'near'],
};

/** Camera-relative scenery, with bounded parallax and cover sizing at every aspect ratio.
 * Loading never blocks the match. The existing scenery stays visible until every plate
 * is ready, and remains the fallback if any request fails. Each stage owns its textures.
 */
export function buildScenery(theme: StageTheme, parent: THREE.Group, fallback: THREE.Group): { ready: Promise<void>; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'generated-scenery';
  parent.add(group);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials: THREE.MeshBasicMaterial[] = [];
  const textures: THREE.Texture[] = [];
  const loader = new THREE.TextureLoader();
  let disposed = false;
  const layers = LAYERS[theme];
  const loads = layers.map((name, index) => new Promise<void>((resolve, reject) => {
    const material = new THREE.MeshBasicMaterial({
      transparent: index > 0, depthWrite: false, fog: false, toneMapped: false,
    });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `scenery-${name}`;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = -100 + index;
    group.add(mesh);
    const factor = index === 0 ? 0.08 : index === layers.length - 1 ? 0.6 : 0.28;
    const cameraPosition = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (!(camera instanceof THREE.PerspectiveCamera)) return;
      camera.getWorldPosition(cameraPosition);
      camera.getWorldQuaternion(rotation);
      // Also support the tilted camera and transformed stage root in the asset gallery.
      const distance = Math.min(camera.far * 0.8, Math.max(40, cameraPosition.z + 60 - index));
      const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom;
      const viewWidth = viewHeight * camera.aspect;
      const height = Math.max(viewHeight, viewWidth * 9 / 16) * 1.2;
      const width = height * 16 / 9;
      const ratio = distance / Math.max(16, cameraPosition.z);
      // Clamp inside the overscan, including tall phones, shake, and high boss respawns.
      const dx = THREE.MathUtils.clamp(-cameraPosition.x * factor * ratio, -(width - viewWidth) * 0.45, (width - viewWidth) * 0.45);
      const dy = THREE.MathUtils.clamp(-(cameraPosition.y - 3) * factor * ratio * 0.45, -(height - viewHeight) * 0.45, (height - viewHeight) * 0.45);
      offset.set(dx, dy, -distance).applyQuaternion(rotation).add(cameraPosition);
      scale.set(width, height, 1);
      mesh.matrixWorld.compose(offset, rotation, scale);
    };
    const texture = loader.load(`${import.meta.env.BASE_URL}backgrounds/${theme}/${name}.webp`, loaded => {
      if (disposed) { loaded.dispose(); resolve(); return; }
      loaded.colorSpace = THREE.SRGBColorSpace;
      material.map = loaded;
      material.needsUpdate = true;
      resolve();
    }, undefined, reject);
    textures.push(texture);
  }));
  const ready = Promise.all(loads).then(() => {
    if (disposed) return;
    fallback.visible = false;
    for (const mesh of group.children) mesh.visible = true;
    group.userData.ready = true;
  }).catch(() => {
    if (!disposed) console.warn(`Scenery unavailable for ${theme}; keeping the procedural fallback.`);
  });
  return { ready, dispose() {
    disposed = true;
    group.removeFromParent();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    geometry.dispose();
  } };
}
