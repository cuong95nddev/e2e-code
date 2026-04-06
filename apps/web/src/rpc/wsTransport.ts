import { resolveWsUrl } from "../env";

type Listener = (event: unknown) => void;

export class WsTransport {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  connect(): void {
    const url = resolveWsUrl();
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event: MessageEvent) => {
      const data: unknown = JSON.parse(event.data as string);
      for (const listener of this.listeners) listener(data);
    };
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(method: string, params: unknown): number {
    const id = this.nextId++;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ id, method, params }));
    }
    return id;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export const transport = new WsTransport();
