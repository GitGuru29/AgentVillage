import {
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
} from "three";
import { WS_URL } from "./config";
import { IsoCamera, createRenderer } from "./core/isoCamera";
import { connectVillage } from "./net/wsClient";
import { AgentPanel } from "./ui/panel";
import { Minimap } from "./ui/minimap";
import { ReplayEngine } from "./ui/replay";
import { Scrubber } from "./ui/scrubber";
import { Toasts } from "./ui/toasts";
import { Hud } from "./ui/hud";
import { Village } from "./world/village";

const container = document.getElementById("app");
if (!container) throw new Error("#app container missing");

// --- renderer + isometric camera -----------------------------------------
const renderer = createRenderer(container);
const iso = new IsoCamera();
iso.attach(renderer.domElement);
iso.setSize(container.clientWidth, container.clientHeight);

// --- scene ----------------------------------------------------------------
const scene = new Scene();
scene.background = new Color(0x0b0e1a);

// Cool key light + dim sky fill, soft shadows (server-room ambience).
const sun = new DirectionalLight(0xdde6ff, 2.2);
sun.position.set(34, 52, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45;
sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006;
scene.add(sun);

const sky = new HemisphereLight(0x35486b, 0x14181f, 0.75);
scene.add(sky);

// --- world ----------------------------------------------------------------
const village = new Village(scene);
const hud = new Hud();
village.onCounters = (c) => hud.update(c);

// --- replay engine + Phase 6 UI -------------------------------------------
const engine = new ReplayEngine(village);
const toasts = new Toasts();
engine.onToast = (t) => toasts.push(t);
const panel = new AgentPanel(engine, village);
const minimap = new Minimap(village, iso, (id) => panel.select(id));
const scrubber = new Scrubber(engine);

// --- selection -------------------------------------------------------------
const selectionRing = new Mesh(
  new RingGeometry(0.62, 0.8, 40),
  new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
    depthWrite: false,
  }),
);
selectionRing.rotation.x = -Math.PI / 2;
selectionRing.visible = false;
selectionRing.renderOrder = 5;
scene.add(selectionRing);

const raycaster = new Raycaster();
let downX = 0;
let downY = 0;
renderer.domElement.addEventListener("pointerdown", (ev) => {
  downX = ev.clientX;
  downY = ev.clientY;
});
renderer.domElement.addEventListener("pointerup", (ev) => {
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return; // it was a drag
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(new Vector2(nx, ny), iso.camera);
  const hits = raycaster.intersectObjects(village.agents.map((a) => a.group), true);
  let id: string | null = null;
  if (hits.length > 0) {
    let obj: typeof hits[0]["object"] | null = hits[0]!.object;
    while (obj && typeof obj.userData.agentId !== "string") obj = obj.parent;
    if (obj) id = obj.userData.agentId as string;
  }
  panel.select(id);
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__village = village;
  (window as unknown as Record<string, unknown>).__renderer = renderer;
  (window as unknown as Record<string, unknown>).__iso = iso;
  (window as unknown as Record<string, unknown>).__replay = engine;
  (window as unknown as Record<string, unknown>).__panel = panel;
}

// --- events ----------------------------------------------------------------
const connDot = document.getElementById("conn-dot");
const lastEvent = document.getElementById("last-event");

const client = connectVillage(WS_URL, {
  onStatus: (connected) => connDot?.classList.toggle("on", connected),
  onEvent: (event) => {
    const e = event as { name?: string; type?: string; agent_id?: string };
    if (lastEvent) {
      lastEvent.textContent = `${e.name ?? e.agent_id ?? "?"} → ${e.type ?? "?"}`;
    }
    engine.ingest(event);
  },
});
window.addEventListener("beforeunload", () => client.close());

// --- loop ------------------------------------------------------------------
const clock = new Clock();
let uiTimer = 0;

window.addEventListener("resize", () => {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  iso.setSize(w, h);
});

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  engine.tick(dt);
  village.update(dt);

  const sel = panel.selectedId
    ? village.agents.find((a) => a.agentId === panel.selectedId)
    : undefined;
  selectionRing.visible = sel !== undefined;
  if (sel) {
    selectionRing.position.set(sel.group.position.x, 0.07, sel.group.position.z);
  }

  renderer.render(scene, iso.camera);

  uiTimer += dt;
  if (uiTimer >= 0.1) {
    uiTimer = 0;
    minimap.draw(panel.selectedId);
    panel.refresh();
    scrubber.tickUI();
  }
  requestAnimationFrame(frame);
}
frame();
