import { agentColor, STATE_CSS } from "../world/builder";
import type { Village } from "../world/village";
import type { ReplayEngine } from "./replay";

/**
 * Right-hand agent roster + selected-agent detail.
 * `refresh()` is signature-cached so main can call it every frame.
 */
export class AgentPanel {
  selectedId: string | null = null;
  onSelect?: (agentId: string | null) => void;

  private body: HTMLElement;
  private sig = "";

  constructor(
    private engine: ReplayEngine,
    private village: Village,
  ) {
    this.body = document.getElementById("panel-body")!;
    document.getElementById("panel-close")?.addEventListener("click", () => {
      this.select(null);
    });
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.sig = "";
    this.onSelect?.(id);
    this.refresh();
  }

  refresh(): void {
    const parts: string[] = [String(this.selectedId)];
    for (const a of this.village.agents) {
      parts.push(`${a.agentId}:${a.state}:${a.queueLength}:${a.currentBuilding ?? ""}`);
    }
    for (const [id, s] of this.engine.stats) {
      parts.push(`${id}#${s.events}:${s.lastType}:${s.tokens}:${s.shipped}`);
    }
    const sig = parts.join("|");
    if (sig === this.sig) return;
    this.sig = sig;
    this.render();
  }

  private render(): void {
    const el = this.body;
    el.textContent = "";

    const sel = this.selectedId;
    const builder = sel ? this.village.agents.find((a) => a.agentId === sel) : undefined;
    const stats = sel ? this.engine.stats.get(sel) : undefined;
    if (sel) {
      const detail = document.createElement("div");
      detail.className = "panel-detail";
      const name = document.createElement("div");
      name.className = "detail-name";
      const color = stats ? agentColor(sel) : 0xffffff;
      name.style.color = `#${color.toString(16).padStart(6, "0")}`;
      name.textContent = stats?.name ?? sel;
      const id = document.createElement("div");
      id.className = "detail-id";
      id.textContent = sel;
      detail.append(name, id);

      const chips = document.createElement("div");
      chips.className = "chips";
      const state = builder?.state ?? "offline";
      chips.appendChild(this.chip("state", state, STATE_CSS[builder?.state ?? "idle"] ?? "#6b7386"));
      if (builder?.currentBuilding) chips.appendChild(this.chip("at", builder.currentBuilding));
      chips.appendChild(this.chip("queued", String(builder?.queueLength ?? 0)));
      detail.appendChild(chips);

      if (stats) {
        const grid = document.createElement("div");
        grid.className = "stat-grid";
        grid.append(
          this.kv("events", String(stats.events)),
          this.kv("tokens", stats.tokens.toLocaleString("en-US")),
          this.kv("cost", `$${stats.cost.toFixed(2)}`),
          this.kv("shipped", String(stats.shipped)),
        );
        detail.appendChild(grid);
      }

      const recent = document.createElement("div");
      recent.className = "detail-recent";
      const head = document.createElement("div");
      head.className = "recent-head";
      head.textContent = "RECENT";
      recent.appendChild(head);
      const mine = this.engine.recorded.filter((r) => r.e.agent_id === sel).slice(-6).reverse();
      for (const r of mine) {
        const line = document.createElement("div");
        line.className = "recent-line";
        const type = document.createElement("span");
        type.className = "recent-type";
        type.textContent = typeof r.e.type === "string" ? r.e.type : "?";
        const detailText = document.createElement("span");
        detailText.className = "recent-detail";
        detailText.textContent = typeof r.e.detail === "string" ? r.e.detail : "";
        line.append(type, detailText);
        recent.appendChild(line);
      }
      if (mine.length === 0) {
        const none = document.createElement("div");
        none.className = "recent-line";
        none.textContent = "no events yet";
        recent.appendChild(none);
      }
      detail.appendChild(recent);
      el.appendChild(detail);
    }

    const list = document.createElement("div");
    list.className = "panel-list";
    const entries = [...this.engine.stats.entries()];
    for (const [id, s] of entries) {
      const row = document.createElement("button");
      row.className = "panel-row" + (id === sel ? " selected" : "");
      row.type = "button";
      const sw = document.createElement("span");
      sw.className = "row-swatch";
      sw.style.background = `#${agentColor(id).toString(16).padStart(6, "0")}`;
      const nm = document.createElement("span");
      nm.className = "row-name";
      nm.textContent = s.name;
      const st = document.createElement("span");
      st.className = "row-state";
      const b = this.village.agents.find((a) => a.agentId === id);
      st.textContent = b?.state ?? "—";
      st.style.color = b ? STATE_CSS[b.state] : "#6b7386";
      row.append(sw, nm, st);
      row.addEventListener("click", () => this.select(id));
      list.appendChild(row);
    }
    if (entries.length === 0) {
      const none = document.createElement("div");
      none.className = "panel-empty";
      none.textContent = "waiting for agents…";
      list.appendChild(none);
    }
    el.appendChild(list);
  }

  private chip(label: string, value: string, color?: string): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "chip";
    const l = document.createElement("span");
    l.className = "chip-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "chip-value";
    v.textContent = value;
    if (color) {
      v.style.color = color;
      v.style.borderColor = `${color}55`;
    }
    chip.append(l, v);
    return chip;
  }

  private kv(k: string, v: string): HTMLElement {
    const cell = document.createElement("div");
    cell.className = "kv";
    const val = document.createElement("div");
    val.className = "kv-val";
    val.textContent = v;
    const key = document.createElement("div");
    key.className = "kv-key";
    key.textContent = k;
    cell.append(val, key);
    return cell;
  }
}
