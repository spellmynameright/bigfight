import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildVanguard } from './vanguard';
import { buildWildform } from './wildform';
import { buildRelic } from './relic';
import { motionDuration, sampleMotion } from './motion';
import { motionCameraFrame } from './framing';
import type { ConceptMotion, ConceptRig, ConceptStyle, ConceptSubject } from './types';

const BUILDERS = { vanguard: buildVanguard, wildform: buildWildform, relic: buildRelic };

function rigBounds(rig: ConceptRig, target = new THREE.Box3()): THREE.Box3 {
  rig.root.updateMatrixWorld(true);
  rig.root.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).computeBoundingBox(); });
  return target.setFromObject(rig.root);
}

interface View {
  rig: ConceptRig;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  turntable: THREE.Group;
  shadow: THREE.Mesh;
  size: THREE.Vector3;
  subject: ConceptSubject;
  center: THREE.Vector3;
  ground: number;
  frames: Map<ConceptMotion, THREE.Box3>;
}

/** One WebGL context serves both the cast photographs and the comparison stage. */
export class StudioRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly shadowGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly silhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x1d2940 });
  private views: View[] = [];
  private host: HTMLElement | null = null;
  private slots: HTMLElement[] = [];
  private frame = 0;
  private lastTime = 0;
  private disposed = false;
  yaw = -0.22;
  zoom = 1;
  time = 0;
  motion: ConceptMotion = 'ready';
  playing = false;
  silhouette = false;
  speed = 1;
  onTimeChange: (() => void) | null = null;

  get duration(): number { return this.views[0] ? motionDuration(this.motion, this.views[0].subject) : 1; }
  get phase(): number { return Math.max(0, Math.min(1, this.time / this.duration)); }

  constructor() {
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(this.renderer);
    this.environment = generator.fromScene(room, 0.04);
    room.dispose();
    generator.dispose();
    const shadow = document.createElement('canvas');
    shadow.width = shadow.height = 96;
    const ctx = shadow.getContext('2d')!;
    const gradient = ctx.createRadialGradient(48, 48, 1, 48, 48, 48);
    gradient.addColorStop(0, 'rgba(18, 29, 48, 0.32)');
    gradient.addColorStop(0.5, 'rgba(18, 29, 48, 0.15)');
    gradient.addColorStop(1, 'rgba(18, 29, 48, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    this.shadowMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadow), transparent: true, depthWrite: false, toneMapped: false });
    this.canvas.className = 'studio-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

  private build(style: ConceptStyle, subject: ConceptSubject): View {
    const rig = BUILDERS[style](subject);
    rig.animate(0, 'ready');
    const bounds = rigBounds(rig);
    if (bounds.isEmpty()) { rig.dispose(); throw new Error(`Empty concept: ${style}/${subject.id}`); }
    const size = bounds.getSize(new THREE.Vector3());
    if (![size.x, size.y, size.z].every(Number.isFinite)) { rig.dispose(); throw new Error(`Invalid concept bounds: ${style}/${subject.id}`); }
    const center = bounds.getCenter(new THREE.Vector3());
    const scene = new THREE.Scene();
    scene.environment = this.environment.texture;
    scene.environmentIntensity = 0.65;
    scene.add(new THREE.HemisphereLight(0xe1ecff, 0x8b7c70, 1.7));
    for (const [color, intensity, x, y, z] of [
      [0xffecd8, 3.4, -5, 8, 7], [0xb3d3ff, 1.5, 5, 4, 5], [0xffffff, 2.5, 1, 7, -5],
    ]) {
      const light = new THREE.DirectionalLight(color, intensity);
      light.position.set(x!, y!, z!);
      scene.add(light);
    }
    const turntable = new THREE.Group();
    const mount = new THREE.Group();
    mount.position.set(-center.x, -bounds.min.y, -center.z);
    mount.add(rig.root);
    turntable.add(mount);
    scene.add(turntable);
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.012;
    shadow.scale.set(Math.max(size.x * 1.2, size.y * 0.8), Math.max(size.z * 1.5, size.y * 0.65), 1);
    scene.add(shadow);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 200);
    return { rig, scene, camera, turntable, shadow, size, subject, center, ground: bounds.min.y, frames: new Map() };
  }

  private movementFrame(view: View): THREE.Box3 {
    if (!view.frames.has(this.motion)) {
      // One fixed frame per movement keeps anticipation and landing readable.
      const envelope = new THREE.Box3();
      const sample = new THREE.Box3();
      const duration = motionDuration(this.motion, view.subject);
      const parent = view.rig.root.parent!;
      parent.remove(view.rig.root);
      try {
        for (let step = 0; step < 32; step++) {
          view.rig.animate(duration * step / 32, this.motion);
          envelope.union(rigBounds(view.rig, sample));
        }
      } finally { parent.add(view.rig.root); }
      view.frames.set(this.motion, envelope);
    }
    return view.frames.get(this.motion)!;
  }

  private pose(view: View, width: number, height: number, thumbnail = false): void {
    const { camera } = view;
    const bounds = thumbnail ? null : this.movementFrame(view);
    view.rig.animate(thumbnail ? 0 : this.time, thumbnail ? 'ready' : this.motion);
    view.turntable.rotation.y = thumbnail ? -0.22 : this.yaw;
    view.scene.overrideMaterial = this.silhouette ? this.silhouetteMaterial : null;
    view.shadow.visible = !this.silhouette;
    const lift = thumbnail ? 0 : sampleMotion(this.time, this.motion, view.subject).airborne;
    this.shadowMaterial.opacity = 1 - lift * 0.55;
    const spread = 1 - lift * 0.2;
    view.shadow.scale.set(Math.max(view.size.x * 1.2, view.size.y * 0.8) * spread, Math.max(view.size.z * 1.5, view.size.y * 0.65) * spread, 1);
    camera.aspect = width / Math.max(1, height);
    if (bounds) {
      const frame = motionCameraFrame(bounds, view.center, view.ground, this.yaw, camera.aspect, camera.fov);
      const distance = frame.distance * this.zoom;
      camera.position.set(0, frame.targetY + Math.sin(frame.tilt) * distance, Math.cos(frame.tilt) * distance);
      camera.lookAt(0, frame.targetY, 0);
    } else {
      const size = view.size;
      const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
      const distance = Math.max(size.y / Math.tan(vertical), Math.max(size.x, size.z) / Math.tan(horizontal)) * 0.59 + size.z * 0.45;
      camera.position.set(0, size.y * 0.54, distance);
      camera.lookAt(0, size.y * 0.48, 0);
    }
    camera.updateProjectionMatrix();
  }

  photograph(style: ConceptStyle, subject: ConceptSubject): string {
    if (this.host) throw new Error('Close the comparison before photographing the cast.');
    const view = this.build(style, subject);
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(360, 380, false);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, 360, 380);
      this.pose(view, 360, 380, true);
      this.renderer.render(view.scene, view.camera);
      return this.canvas.toDataURL('image/png');
    } finally { view.rig.dispose(); }
  }

  open(host: HTMLElement, slots: HTMLElement[], subject: ConceptSubject): void {
    this.close();
    this.host = host;
    this.slots = slots;
    try { for (const style of ['vanguard', 'wildform', 'relic'] as const) this.views.push(this.build(style, subject)); }
    catch (error) { this.close(); throw error; }
    host.prepend(this.canvas);
    this.time = 0;
    this.reset();
  }

  reset(): void { this.yaw = -0.22; this.zoom = 1; this.render(); }

  render(): void {
    if (!this.host || this.disposed) return;
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(devicePixelRatio, 1.5, Math.sqrt(3_000_000 / (width * height)));
    if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
    this.renderer.clear();
    this.renderer.setScissorTest(true);
    this.views.forEach((view, index) => {
      const slot = this.slots[index]!.getBoundingClientRect();
      const x = slot.left - rect.left;
      const y = height - (slot.top - rect.top) - slot.height;
      this.renderer.setViewport(x, y, slot.width, slot.height);
      this.renderer.setScissor(x, y, slot.width, slot.height);
      this.pose(view, slot.width, slot.height);
      this.renderer.render(view.scene, view.camera);
    });
    this.renderer.setScissorTest(false);
    this.onTimeChange?.();
  }

  play(value: boolean): void {
    this.playing = value;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (!value || !this.host || document.hidden) return;
    this.lastTime = performance.now();
    const tick = (now: number): void => {
      this.frame = 0;
      if (!this.playing || !this.host || document.hidden) return;
      if (now - this.lastTime >= 1000 / 30) {
        this.time = (this.time + Math.min(0.1, (now - this.lastTime) / 1000) * this.speed) % this.duration;
        this.lastTime = now;
        this.render();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  close(): void {
    this.play(false);
    for (const view of this.views) view.rig.dispose();
    this.views = [];
    this.slots = [];
    this.host = null;
    this.canvas.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.close();
    this.disposed = true;
    this.shadowGeometry.dispose();
    this.shadowMaterial.map?.dispose();
    this.shadowMaterial.dispose();
    this.silhouetteMaterial.dispose();
    this.environment.dispose();
    this.renderer.dispose();
  }
}
