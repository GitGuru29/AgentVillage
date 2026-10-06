import {
  Clock,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
} from "three";
import { WS_URL } from "./config";
import { IsoCamera, createRenderer } from "./core/isoCamera";
import { connectVillage } from "./net/wsClient";
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
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__village = village;
  (window as unknown as Record<string, unknown>).__renderer = renderer;
  (window as unknown as Record<string, unknown>).__iso = iso;
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
    village.handleEvent(event);
  },
});
window.addEventListener("beforeunload", () => client.close());

// --- loop ------------------------------------------------------------------
const clock = new Clock();

window.addEventListener("resize", () => {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  iso.setSize(w, h);
});

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  village.update(dt);
  renderer.render(scene, iso.camera);
  requestAnimationFrame(frame);
}
frame();
