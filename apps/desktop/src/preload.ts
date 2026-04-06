import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@claude-desktop/contracts";

const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => {
    const result = ipcRenderer.sendSync(GET_WS_URL_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
} satisfies DesktopBridge);
