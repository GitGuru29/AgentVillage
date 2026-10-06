import type { Counters } from "../world/village";

/** Game-HUD top bar: gold (tokens), elixir (cost), trophies, builders. */
export class Hud {
  private gold: HTMLElement | null;
  private elixir: HTMLElement | null;
  private trophies: HTMLElement | null;
  private builders: HTMLElement | null;
  private last = "";

  constructor() {
    this.gold = document.getElementById("stat-gold");
    this.elixir = document.getElementById("stat-elixir");
    this.trophies = document.getElementById("stat-trophies");
    this.builders = document.getElementById("stat-builders");
    this.update({ gold: 0, elixir: 0, trophies: 0, active: 0, total: 0 });
  }

  update(c: Counters): void {
    const next = `${c.gold}|${c.elixir}|${c.trophies}|${c.active}|${c.total}`;
    if (next === this.last) return;
    this.last = next;
    if (this.gold) this.gold.textContent = c.gold.toLocaleString("en-US");
    if (this.elixir) this.elixir.textContent = `$${c.elixir.toFixed(2)}`;
    if (this.trophies) this.trophies.textContent = String(c.trophies);
    if (this.builders) this.builders.textContent = `${c.active} / ${c.total}`;
  }
}
