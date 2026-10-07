import { STATE_CSS } from "../world/builder";
import { BUILDINGS, WALLS, type BuildingKey } from "../world/layout";
import type { Village } from "../world/village";
import type { IsoCamera } from "../core/isoCamera";

/** Top-down wall/building/agent map. Click to pan; click a dot to select. */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private size = 190;
  private dpr = 1;

  /** Accent per building — echoes the in-world palette. */
  private static ACCENT: Record<BuildingKey, string> = {
    command: "#7ef0ff",
    docs: "#cfd8ea",
    devfloor: "#4fe3c1",
    ops: "#ffb84d",
    qa: "#4fd67a",
    racks: "#5b8cff",
    power: "#ffd76a",
    release: "#e0a3ff",
    incident: "#e05252",
    noc: "#7aa2ff",
    gate: "#ffb84d",
    debug: "#ff8a3d",
    dock: "#58c7ff",
  };

  constructor(
    private village: Village,
    private iso: IsoCamera,
    private onSelect?: (agentId: string | null) => void,
  ) {
    this.canvas = document.getElementById("minimap") as HTMLCanvasElement;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("minimap 2d context missing");
    this.ctx = ctx;
    this.canvas.addEventListener("pointerdown", (ev) => this.click(ev));
  }

  /** World (-24..24, -20..20) → canvas px. */
  private toPx(wx: number, wz: number): [number, number] {
    const pad = 12;
    const s = Math.min(
      (this.size - pad * 2) / 48,
      (this.size - pad * 2) / 40,
    );
    return [this.size / 2 + wx * s, this.size / 2 + wz * s];
  }

  private click(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    // agent dots win over panning
    for (const a of this.village.agents) {
      const [dx, dy] = this.toPx(a.group.position.x, a.group.position.z);
      if (Math.hypot(px - dx, py - dy) <= 7) {
        this.onSelect?.(a.agentId);
        return;
      }
    }
    const pad = 12;
    const s = Math.min((this.size - pad * 2) / 48, (this.size - pad * 2) / 40);
    this.iso.panTo((px - this.size / 2) / s, (py - this.size / 2) / s);
  }

  draw(selectedId: string | null): void {
    const { ctx, size } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // plate
    ctx.fillStyle = "#0c101c";
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, size - 1, size - 1, 12);
    ctx.fill();
    ctx.stroke();

    // interior floor
    const [ix, iy] = this.toPx(-23, -19);
    const [jx, jy] = this.toPx(23, 19);
    ctx.fillStyle = "#141a28";
    ctx.fillRect(ix, iy, jx - ix, jy - iy);

    // wall ring
    ctx.strokeStyle = "#5d6a86";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const w of WALLS) {
      const [ax, ay] = this.toPx(w.ax, w.az);
      const [bx, by] = this.toPx(w.bx, w.bz);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // buildings
    for (const spec of BUILDINGS) {
      const [x0, y0] = this.toPx(spec.x - spec.w / 2, spec.z - spec.d / 2);
      const [x1, y1] = this.toPx(spec.x + spec.w / 2, spec.z + spec.d / 2);
      ctx.fillStyle = Minimap.ACCENT[spec.key];
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.globalAlpha = 1;
    }

    // agents
    for (const a of this.village.agents) {
      const [x, y] = this.toPx(a.group.position.x, a.group.position.z);
      const color = STATE_CSS[a.state] ?? "#7ef0ff";
      if (a.agentId === selectedId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(10,14,24,0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
