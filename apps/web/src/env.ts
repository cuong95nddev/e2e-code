declare global {
  interface Window {
    desktopBridge?: {
      getWsUrl: () => string | null;
      pickFolder: () => Promise<string | null>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export const isElectron = typeof window !== "undefined" && !!window.desktopBridge;

export function resolveWsUrl(): string {
  if (isElectron) {
    const url = window.desktopBridge!.getWsUrl();
    if (url) return url;
  }
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
}
