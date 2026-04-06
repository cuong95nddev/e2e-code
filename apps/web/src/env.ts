declare global {
  interface Window {
    desktopBridge: {
      getWsUrl: () => string | null;
      pickFolder: () => Promise<string | null>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export function resolveWsUrl(): string {
  if (window.desktopBridge?.getWsUrl) {
    const url = window.desktopBridge.getWsUrl();
    if (url) return url;
  }
  // Fallback for browser dev or when preload fails
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  // Default to same host on common dev port
  return `ws://${window.location.hostname}:${window.location.port}/ws`;
}
