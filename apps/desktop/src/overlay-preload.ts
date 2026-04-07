import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overlayAPI", {
  sendResult: (region: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("overlay:result", region),
  cancel: () => ipcRenderer.send("overlay:cancel"),
});
