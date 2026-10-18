// The only bridge the web app sees on desktop: print a receipt, list printers. No Node access.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  platform: process.platform,
  print: (html, printer) => ipcRenderer.invoke("pos:print", { html, printer }),
  printers: () => ipcRenderer.invoke("pos:printers"),
});
