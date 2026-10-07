import type { ToastSpec } from "./replay";

/** Bottom-left notification stack: errors, approvals, ships, crashes. */
export class Toasts {
  private el: HTMLElement;

  constructor() {
    this.el = document.getElementById("toasts")!;
  }

  push(t: ToastSpec): void {
    while (this.el.children.length >= 4) {
      this.el.firstElementChild?.remove();
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.style.borderLeftColor = t.color;
    const dot = document.createElement("span");
    dot.className = "toast-dot";
    dot.style.background = t.color;
    dot.style.boxShadow = `0 0 7px ${t.color}`;
    const body = document.createElement("div");
    body.className = "toast-body";
    const title = document.createElement("div");
    title.className = "toast-title";
    title.textContent = t.title;
    body.appendChild(title);
    if (t.detail) {
      const detail = document.createElement("div");
      detail.className = "toast-detail";
      detail.textContent = t.detail;
      body.appendChild(detail);
    }
    toast.append(dot, body);
    this.el.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("out");
      setTimeout(() => toast.remove(), 300);
    }, t.ms ?? 5000);
  }
}
