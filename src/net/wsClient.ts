/**
 * Reconnecting WebSocket client for the ingest server.
 * Same event schema whether it arrives via WS broadcast or HTTP POST.
 */

export interface VillageClientHandlers {
  onEvent: (event: unknown) => void;
  onStatus?: (connected: boolean) => void;
}

export interface VillageClient {
  close: () => void;
  isOpen: () => boolean;
}

export function connectVillage(url: string, handlers: VillageClientHandlers): VillageClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let open = false;
  let retry: ReturnType<typeof setTimeout>;

  const setStatus = (v: boolean) => {
    open = v;
    handlers.onStatus?.(v);
  };

  const start = () => {
    if (closed) return;
    ws = new WebSocket(url);

    ws.onopen = () => setStatus(true);
    ws.onclose = () => {
      setStatus(false);
      if (!closed) retry = setTimeout(start, 1500);
    };
    ws.onerror = () => ws?.close();
    ws.onmessage = (msg) => {
      try {
        handlers.onEvent(JSON.parse(msg.data as string));
      } catch {
        /* malformed frame */
      }
    };
  };

  start();

  return {
    close: () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    },
    isOpen: () => open,
  };
}
