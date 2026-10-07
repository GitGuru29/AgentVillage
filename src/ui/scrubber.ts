import type { ReplayEngine } from "./replay";

/** Bottom timeline: scrub, play/pause, speed, live. */
export class Scrubber {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private btnPlay: HTMLButtonElement;
  private btnSpeed: HTMLButtonElement;
  private btnLive: HTMLButtonElement;
  private label: HTMLElement;
  private dragging = false;
  private lastDraw = 0;

  constructor(private engine: ReplayEngine) {
    this.canvas = document.getElementById("scrub-timeline") as HTMLCanvasElement;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("scrub timeline 2d context missing");
    this.ctx = ctx;
    this.btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
    this.btnSpeed = document.getElementById("btn-speed") as HTMLButtonElement;
    this.btnLive = document.getElementById("btn-live") as HTMLButtonElement;
    this.label = document.getElementById("scrub-label")!;

    this.btnPlay.addEventListener("click", () => {
      if (this.engine.mode === "live") this.engine.pause();
      else if (this.engine.paused) this.engine.play();
      else this.engine.pause();
    });
    this.btnSpeed.addEventListener("click", () => this.engine.cycleSpeed());
    this.btnLive.addEventListener("click", () => this.engine.goLive());

    const seekAt = (ev: PointerEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t0 = this.engine.firstT;
      const end = Math.max(Date.now(), this.engine.lastT, t0 + 1000);
      this.engine.seek(t0 + frac * (end - t0));
    };
    this.canvas.addEventListener("pointerdown", (ev) => {
      this.dragging = true;
      this.canvas.setPointerCapture(ev.pointerId);
      seekAt(ev);
    });
    this.canvas.addEventListener("pointermove", (ev) => {
      if (this.dragging) seekAt(ev);
    });
    this.canvas.addEventListener("pointerup", (ev) => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture(ev.pointerId)) {
        this.canvas.releasePointerCapture(ev.pointerId);
      }
    });
    this.refresh();
  }

  /** Called from the frame loop (self-throttled). */
  tickUI(): void {
    const now = performance.now();
    if (now - this.lastDraw < 150) return;
    this.lastDraw = now;
    this.refresh();
  }

  refresh(): void {
    const { engine } = this;
    const replay = engine.mode === "replay";
    this.btnPlay.textContent = replay && !engine.paused ? "⏸" : "▶";
    this.btnSpeed.textContent = `×${engine.speed}`;
    this.btnLive.classList.toggle("show", replay);
    if (replay) {
      const a = fmt(engine.replayTime - engine.firstT);
      const b = fmt(Date.now() - engine.firstT);
      this.label.textContent = `${a} / ${b}`;
      this.label.classList.add("replay-label");
    } else {
      this.label.textContent = "LIVE";
      this.label.classList.remove("replay-label");
    }
    this.draw();
  }

  private draw(): void {
    const { ctx, canvas, engine } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t0 = engine.firstT;
    const end = Math.max(Date.now(), engine.lastT, t0 + 1000);
    const span = end - t0;
    const x = (t: number) => ((t - t0) / span) * w;

    // track
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(0, h / 2 - 6, w, 12, 6);
    ctx.fill();

    // played region while in replay
    if (engine.mode === "replay") {
      ctx.fillStyle = "rgba(126,240,255,0.14)";
      ctx.beginPath();
      ctx.roundRect(0, h / 2 - 6, x(engine.replayTime), 12, 6);
      ctx.fill();
    }

    // event ticks
    const tape = engine.recorded;
    const stride = Math.max(1, Math.ceil(tape.length / Math.max(60, w / 2)));
    for (let i = 0; i < tape.length; i += stride) {
      const e = tape[i]!.e;
      ctx.fillStyle = tickColor(e.type, e.detail);
      const tx = x(tape[i]!.t);
      ctx.fillRect(tx, h / 2 - 5, 1.4, 10);
    }

    // playhead
    const head = engine.mode === "replay" ? engine.replayTime : Date.now();
    const hx = x(head);
    ctx.fillStyle = engine.mode === "replay" ? "#7ef0ff" : "#4fd67a";
    ctx.fillRect(hx - 1, h / 2 - 8, 2, 16);
  }
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function tickColor(type: unknown, detail: unknown): string {
  switch (type) {
    case "error":
      return "#e05252";
    case "approval":
    case "security_check":
      return "#ffb84d";
    case "ship":
      return "#4fd67a";
    case "done":
      return "#4fd67a";
    case "test":
      return typeof detail === "string" && /\b(fail(ed|ure)?|✗|broken)\b/i.test(detail)
        ? "#d0342c"
        : "#4fd67a";
    case "plan":
    case "read":
      return "#7ef0ff";
    case "write":
      return "#4fe3c1";
    case "tool_call":
    case "debug":
      return "#9d8cff";
    case "token_usage":
      return "#6b7386";
    default:
      return "#55607a";
  }
}
