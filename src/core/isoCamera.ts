import {
  ACESFilmicToneMapping,
  OrthographicCamera,
  PCFSoftShadowMap,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  CAMERA_PITCH,
  CAMERA_YAW,
  WORLD_HALF_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../config";

const FRUSTUM = 30;

/**
 * Fixed isometric camera: pan (drag) + zoom (wheel) only, no free rotate.
 * Yaw is locked at 45°, pitch at ~35.26°.
 */
export class IsoCamera {
  readonly camera: OrthographicCamera;
  private target = new Vector3(0, 0, 0);
  private zoomLevel = 1;
  private width = 1;
  private height = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private detachFns: Array<() => void> = [];

  constructor() {
    this.camera = new OrthographicCamera(-FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, -200, 500);
    this.camera.position.set(0, 40, 40);
    this.update();
  }

  attach(el: HTMLElement): void {
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 && ev.button !== 1) return;
      this.dragging = true;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      el.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      if (!this.dragging) return;
      this.pan(ev.clientX - this.lastX, ev.clientY - this.lastY);
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
    };
    const onUp = (ev: PointerEvent) => {
      this.dragging = false;
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const factor = Math.exp(-ev.deltaY * 0.0015);
      this.zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoomLevel * factor));
      this.update();
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    this.detachFns.push(() => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    });
  }

  /** Screen-space drag → world-space pan on the ground plane. */
  private pan(dx: number, dy: number): void {
    const viewHeight = (FRUSTUM * 2) / this.zoomLevel;
    const worldPerPixel = viewHeight / this.height;

    const dir = this.camera.position.clone().sub(this.target);
    dir.y = 0;
    dir.normalize();
    const right = new Vector3(dir.z, 0, -dir.x);
    const forward = new Vector3(-dir.x, 0, -dir.z);

    this.target.addScaledVector(right, -dx * worldPerPixel);
    this.target.addScaledVector(forward, dy * worldPerPixel);
    this.target.x = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, this.target.x));
    this.target.z = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, this.target.z));
    this.update();
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.update();
  }

  /** Snap the view centre to a world point (minimap click, focus). */
  panTo(x: number, z: number): void {
    this.target.x = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, x));
    this.target.z = Math.max(-WORLD_HALF_SIZE, Math.min(WORLD_HALF_SIZE, z));
    this.update();
  }

  update(): void {
    const aspect = this.width / this.height;
    const h = FRUSTUM;
    const w = h * aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.zoom = this.zoomLevel;
    this.camera.updateProjectionMatrix();

    const dist = 100;
    this.camera.position.set(
      this.target.x + dist * Math.cos(CAMERA_PITCH) * Math.sin(CAMERA_YAW),
      this.target.y + dist * Math.sin(CAMERA_PITCH),
      this.target.z + dist * Math.cos(CAMERA_PITCH) * Math.cos(CAMERA_YAW),
    );
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    for (const fn of this.detachFns) fn();
    this.detachFns = [];
  }
}

export function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  return renderer;
}
