import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
} from "three";
import { WS_URL } from "./config";
import { IsoCamera, createRenderer } from "./core/isoCamera";
import { connectVillage } from "./net/wsClient";

const container = document.getElementById("app");
if (!container) throw new Error("#app container missing");

// --- renderer + isometric camera -----------------------------------------
const renderer = createRenderer(container);
const iso = new IsoCamera();
iso.attach(renderer.domElement);
iso.setSize(container.clientWidth, container.clientHeight);

// --- scene ----------------------------------------------------------------
const scene = new Scene();
scene.background = new Color(0x9fd4f2);

// Grass ground (tiles come with the terrain pass).
const ground = new Mesh(
  new PlaneGeometry(220, 220),
  new MeshStandardMaterial({ color: 0x6cb84a, roughness: 1, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Warm key light + sky fill, soft shadows.
const sun = new DirectionalLight(0xfff0d4, 2.2);
sun.position.set(34, 52, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006;
scene.add(sun);

const sky = new HemisphereLight(0xcfe6ff, 0x4f7c3a, 0.75);
scene.add(sky);

// --- HUD glue --------------------------------------------------------------
const connDot = document.getElementById("conn-dot");
const lastEvent = document.getElementById("last-event");

const client = connectVillage(WS_URL, {
  onStatus: (connected) => connDot?.classList.toggle("on", connected),
  onEvent: (event) => {
    const e = event as { name?: string; type?: string; agent_id?: string };
    if (lastEvent) {
      lastEvent.textContent = `${e.name ?? e.agent_id ?? "?"} → ${e.type ?? "?"}`;
    }
  },
});
window.addEventListener("beforeunload", () => client.close());

// --- loop ------------------------------------------------------------------
window.addEventListener("resize", () => {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  iso.setSize(w, h);
});

function frame(): void {
  renderer.render(scene, iso.camera);
  requestAnimationFrame(frame);
}
frame();
