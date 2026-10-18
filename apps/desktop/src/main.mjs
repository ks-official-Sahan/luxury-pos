import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from "electron";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The till loads the bundled web build from https://pos.local (intercepted, never
 * leaves the machine), so the UI opens even with no network. Requests to /api/* are proxied to the store's API by the
 * main process, which keeps the session cookie first-party and out of reach of
 * page scripts. The API URL comes from POS_API_URL or the --api= flag.
 */
const API_URL = (process.argv.find((a) => a.startsWith("--api="))?.slice(6) ?? process.env.POS_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const WEB_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const HOST = "pos.local";
const ORIGIN = `https://${HOST}`;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };

if (!app.requestSingleInstanceLock()) app.quit();

async function serveFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(WEB_ROOT, safe);
  if (!file.startsWith(WEB_ROOT)) return new Response("Forbidden", { status: 403 });
  try {
    return new Response(await readFile(file), { headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" } });
  } catch {
    // Single-page app: unknown paths render the shell and the router takes over.
    return new Response(await readFile(join(WEB_ROOT, "index.html")), { headers: { "content-type": "text/html" } });
  }
}

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "cookie", "origin", "transfer-encoding"]);

/** Stores Set-Cookie from the API in the session jar under the API's URL (page scripts never see it). */
async function storeCookies(setCookies) {
  const jar = session.defaultSession.cookies;
  for (const line of setCookies) {
    const [pair, ...attrs] = line.split(";").map((p) => p.trim());
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const maxAge = attrs.find((a) => /^max-age=/i.test(a));
    const expires = attrs.find((a) => /^expires=/i.test(a));
    const expirationDate = maxAge ? Date.now() / 1000 + Number(maxAge.split("=")[1]) : expires ? Date.parse(expires.slice(8)) / 1000 : undefined;
    if (!value || (expirationDate !== undefined && expirationDate <= Date.now() / 1000)) await jar.remove(API_URL, name);
    else await jar.set({ url: API_URL, name, value, httpOnly: true, secure: API_URL.startsWith("https://"), expirationDate });
  }
}

/**
 * Forwards an /api request to the store's API. The page (https://pos.local) and the API
 * are different sites, so Chromium would drop the SameSite=Lax session cookie; the main
 * process keeps it in the session jar and attaches it itself.
 */
async function proxy(request, target) {
  const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
  const cookie = (await session.defaultSession.cookies.get({ url: API_URL })).map((c) => `${c.name}=${c.value}`).join("; ");
  return new Promise((resolve) => {
    const req = net.request({ method: request.method, url: target, credentials: "omit", redirect: "manual" });
    request.headers.forEach((value, key) => !HOP_BY_HOP.has(key.toLowerCase()) && req.setHeader(key, value));
    req.setHeader("origin", ORIGIN);
    if (cookie) req.setHeader("cookie", cookie);
    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", async () => {
        await storeCookies([res.headers["set-cookie"] ?? []].flat()).catch(() => {});
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (k !== "set-cookie") for (const one of [v].flat()) headers.append(k, String(one));
        resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on("error", () => resolve(new Response(JSON.stringify({ error: { code: "network", message: "API unreachable" } }), { status: 503, headers: { "content-type": "application/json" } })));
    if (body?.length) req.write(body);
    req.end();
  });
}

function registerProtocol() {
  // Better Auth needs an http(s) origin, so the app lives on an intercepted https host;
  // every other https request passes through untouched.
  protocol.handle("https", async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return net.fetch(request, { bypassCustomProtocolHandlers: true });
    if (url.pathname.startsWith("/api/")) return proxy(request, `${API_URL}${url.pathname}${url.search}`);
    return serveFile(url.pathname === "/" ? "/index.html" : url.pathname);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#F7F4EE",
    title: "Luxury POS",
    autoHideMenuBar: true,
    kiosk: process.argv.includes("--kiosk"),
    webPreferences: {
      preload: join(fileURLToPath(new URL(".", import.meta.url)), "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  // Never navigate away from the app; open external links in the system browser.
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (url.startsWith("https://")) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL(`${ORIGIN}/`);
}

/** Silent receipt printing to the default (or named) printer. The HTML comes from the app, sandboxed in a hidden window. */
ipcMain.handle("pos:print", async (_e, { html, printer }) => {
  if (typeof html !== "string" || html.length > 200_000) throw new Error("invalid receipt");
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return new Promise((resolve) => {
    w.webContents.print({ silent: true, printBackground: true, deviceName: typeof printer === "string" ? printer : undefined, margins: { marginType: "none" } }, (ok, reason) => {
      w.destroy();
      resolve({ ok, reason: ok ? null : reason });
    });
  });
});

ipcMain.handle("pos:printers", async (e) => (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault })));

app.on("second-instance", () => {
  const [w] = BrowserWindow.getAllWindows();
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.whenReady().then(() => {
  registerProtocol();
  // Deny every permission prompt except what a till needs (none by default).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(ORIGIN) || details.url.includes("/api/")) return callback({});
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self'",
        ],
      },
    });
  });
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
