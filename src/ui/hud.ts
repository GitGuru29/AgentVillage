import type { Counters } from "../world/village";

/** Ops-HUD top bar: tokens, cost, shipped releases, agents online. */
export class Hud {
  private tokens: HTMLElement | null;
  private cost: HTMLElement | null;
  private shipped: HTMLElement | null;
  private agents: HTMLElement | null;
  private last = "";

  constructor() {
    this.tokens = document.getElementById("stat-tokens");
    this.cost = document.getElementById("stat-cost");
    this.shipped = document.getElementById("stat-shipped");
    this.agents = document.getElementById("stat-agents");
    this.update({ tokens: 0, cost: 0, shipped: 0, active: 0, total: 0 });
  }

  update(c: Counters): void {
    const next = `${c.tokens}|${c.cost}|${c.shipped}|${c.active}|${c.total}`;
    if (next === this.last) return;
    this.last = next;
    if (this.tokens) this.tokens.textContent = c.tokens.toLocaleString("en-US");
    if (this.cost) this.cost.textContent = `$${c.cost.toFixed(2)}`;
    if (this.shipped) this.shipped.textContent = String(c.shipped);
    if (this.agents) this.agents.textContent = `${c.active} / ${c.total}`;
  }
}
