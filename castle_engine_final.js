/**
 * castle_engine_final.js
 * ═══════════════════════════════════════════════════════════════
 * Twitter Castle token generator — Pure Node.js + jsdom
 * No browser required. Each token gets a unique device fingerprint.
 *
 * Key design:
 *  • Chrome/150 fixed — must match the login request UA & impersonate
 *  • Proxy IP injected via RTCPeerConnection stub — castle fingerprint
 *    matches the request IP so Twitter doesn't flag IP mismatch
 *  • All canvas/audio/GPU values are randomised per token
 *
 * Usage:
 *   node castle_engine_final.js [count] [--threads N] [--ip=1.2.3.4] [--stdout]
 *   node castle_engine_final.js 10 --threads 5
 *   node castle_engine_final.js 1 --stdout --ip=92.40.200.195
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const nodeCrypto = require("crypto");

// ── Constants ───────────────────────────────────────────────────────────────
const CASTLE_PK = "pk_AvRa79bHyJSYSQHnRpcVtzyxetSvFerx";
const SDK_FILE  = path.join(__dirname, "castle_cdn_sdk.js");
const OUT_FILE  = path.join(__dirname, "castle_token.txt");

// ── CLI args ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const COUNT      = parseInt(args.find(a => /^\d+$/.test(a)) ?? "1", 10);
const THREADS    = parseInt((args.find(a => a.startsWith("--threads=")) ?? "=3").split("=")[1], 10)
                 || (args.includes("--threads") ? parseInt(args[args.indexOf("--threads") + 1]) : 3);
const STDOUT     = args.includes("--stdout");
const IP_ARG     = args.find(a => a.startsWith("--ip="));
const PROXY_IP   = IP_ARG ? IP_ARG.split("=")[1] : null;

// ── Helpers ──────────────────────────────────────────────────────────────────
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Random device fingerprint ────────────────────────────────────────────────
function makeDeviceProfile() {
  const screens = [
    [1920,1080],[2560,1440],[1366,768],[1440,900],[1536,864],
    [1280,800],[1600,900],[1280,1024],[3840,2160],[2560,1080],
    [1920,1200],[1680,1050],
  ];
  const [sw, sh] = pick(screens);

  const gpus = [
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Super Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (AMD)",    renderer:"ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (AMD)",    renderer:"ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (Intel)",  renderer:"ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (Intel)",  renderer:"ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  ];
  const gpu = pick(gpus);

  // Chrome version FIXED at 150 — must match login UA and impersonate
  const chromeVer = "150";

  const cores  = pick([2, 4, 6, 8, 10, 12, 16]);
  const memory = pick([2, 4, 8, 16]);
  const tz     = pick([-480, -420, -360, -300, -240, -120, 0, 60, 120, 180, 300, 330, 540]);
  const lang   = pick(["en-US", "en-GB", "en-US,en;q=0.9", "en-GB,en;q=0.9"]);
  const langs  = pick([["en-US","en"], ["en-GB","en"], ["en-US","en","pl"], ["en-US","en-GB","en"]]);

  // Canvas noise — 32 unique bytes per device
  const canvasNoise = nodeCrypto.randomBytes(32);
  const audioNoise  = (Math.random() * 0.0001).toFixed(10);

  // Memory (heap) — realistic values
  const heapTotal = rand(200, 800) * 1024 * 1024;
  const heapUsed  = rand(80, Math.floor(heapTotal * 0.7 / (1024*1024))) * 1024 * 1024;

  return { sw, sh, gpu, chromeVer, cores, memory, tz, lang, langs,
           canvasNoise, audioNoise, heapTotal, heapUsed };
}

// ── Build jsdom window with full fingerprint stubs ───────────────────────────
function buildWindow(dev, sdkCode, proxyIP) {
  const innerW = dev.sw;
  const innerH = dev.sh - rand(80, 140);

  const vc = new VirtualConsole();
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url:            "https://x.com/i/jf/onboarding/web",
    pretendToBeVisual: true,
    virtualConsole: vc,
    runScripts:     "dangerously",
    resources:      "usable",
  });

  const win = dom.window;

  // ── Window dimensions ──────────────────────────────────────────────────────
  Object.defineProperties(win, {
    innerWidth:  { get: () => innerW, configurable: true },
    innerHeight: { get: () => innerH, configurable: true },
    outerWidth:  { get: () => dev.sw, configurable: true },
    outerHeight: { get: () => dev.sh, configurable: true },
    devicePixelRatio: { get: () => pick([1, 1.25, 1.5, 2]), configurable: true },
  });

  // ── Screen ─────────────────────────────────────────────────────────────────
  const screenDefs = {
    width: dev.sw, height: dev.sh, availWidth: dev.sw, availHeight: dev.sh - 40,
    colorDepth: 24, pixelDepth: 24,
  };
  for (const [k, v] of Object.entries(screenDefs)) {
    Object.defineProperty(win.screen, k, { get: () => v, configurable: true });
  }

  // ── Navigator ──────────────────────────────────────────────────────────────
  const nav = win.navigator;
  Object.defineProperties(nav, {
    userAgent: { get: () => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${dev.chromeVer}.0.0.0 Safari/537.36`, configurable: true },
    platform:  { get: () => "Win32", configurable: true },
    hardwareConcurrency: { get: () => dev.cores, configurable: true },
    deviceMemory: { get: () => dev.memory, configurable: true },
    maxTouchPoints: { get: () => 0, configurable: true },
    language:  { get: () => dev.lang, configurable: true },
    languages: { get: () => dev.langs, configurable: true },
    vendor:    { get: () => "Google Inc.", configurable: true },
    cookieEnabled: { get: () => true, configurable: true },
    doNotTrack: { get: () => null, configurable: true },
    webdriver: { get: () => undefined, configurable: true },
    pdfViewerEnabled: { get: () => true, configurable: true },
    connection: { get: () => ({ effectiveType: "4g", rtt: rand(20,80), downlink: rand(10,100), saveData: false }), configurable: true },
    getBattery: { value: () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 0.98 }), configurable: true },
    mediaDevices: { get: () => ({ enumerateDevices: () => Promise.resolve([]) }), configurable: true },
    permissions: { get: () => ({ query: () => Promise.resolve({ state: "granted" }) }), configurable: true },
    plugins: { get: () => ({ length: 3, item: () => null, namedItem: () => null }), configurable: true },
    mimeTypes: { get: () => ({ length: 2 }), configurable: true },
  });

  // ── Canvas ──────────────────────────────────────────────────────────────────
  const noise = dev.canvasNoise;
  function makeCtx2D() {
    const pixels = new Uint8ClampedArray(4 * 300 * 150);
    for (let i = 0; i < pixels.length; i++) pixels[i] = noise[i % noise.length];
    return {
      fillStyle: "#000", strokeStyle: "#000", font: "10px sans-serif",
      textBaseline: "alphabetic", globalAlpha: 1,
      fillText: () => {}, strokeText: () => {}, fillRect: () => {},
      strokeRect: () => {}, clearRect: () => {},
      beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
      save: () => {}, restore: () => {}, translate: () => {}, scale: () => {},
      measureText: (t) => ({ width: t.length * (5.5 + Math.random() * 0.5) }),
      getImageData: () => ({ data: pixels, width: 300, height: 150 }),
      putImageData: () => {}, createImageData: () => ({ data: new Uint8ClampedArray(4*300*150) }),
      drawImage: () => {}, setTransform: () => {},
    };
  }
  function makeCtxWebGL() {
    return {
      getExtension: (n) => n === "WEBGL_debug_renderer_info" ? { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      getParameter: (p) => {
        if (p === 0x9245) return dev.gpu.vendor;
        if (p === 0x9246) return dev.gpu.renderer;
        if (p === 0x1F00) return dev.gpu.vendor;
        if (p === 0x1F01) return dev.gpu.renderer;
        if (p === 0x1F02) return `WebGL 2.0 (OpenGL ES 3.0 Chromium)`;
        if (p === 0x8B8C) return `WebGL GLSL ES 3.00`;
        if (p === 0x0B20) return 7680;  // MAX_VIEWPORT_DIMS
        return null;
      },
      createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
      createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {}, useProgram: () => {},
      getAttribLocation: () => 0, getUniformLocation: () => ({}),
      createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
      enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
      uniform1f: () => {}, uniform2f: () => {}, uniform4f: () => {},
      viewport: () => {}, clearColor: () => {}, clear: () => {}, drawArrays: () => {},
      deleteShader: () => {}, deleteProgram: () => {}, deleteBuffer: () => {},
      createTexture: () => ({}), bindTexture: () => {}, texImage2D: () => {},
      texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {},
      canvas: { width: 300, height: 150, toDataURL: () => `data:image/png;base64,${noise.toString("base64")}` },
      drawingBufferWidth: 300, drawingBufferHeight: 150,
      getSupportedExtensions: () => ["WEBGL_debug_renderer_info","EXT_color_buffer_float","OES_texture_float"],
    };
  }
  win.HTMLCanvasElement.prototype.getContext = function(type) {
    if (type === "2d") return makeCtx2D();
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return makeCtxWebGL();
    return null;
  };
  win.HTMLCanvasElement.prototype.toDataURL = () => `data:image/png;base64,${noise.toString("base64")}`;

  // ── OfflineAudioContext (audio fingerprint) ──────────────────────────────
  const audioNoise = parseFloat(dev.audioNoise);
  win.OfflineAudioContext = win.OfflineAudioContext || class OfflineAudioContext {
    constructor(channels, frames, rate) {
      this.sampleRate = rate;
      this.destination = { channelCount: channels };
    }
    createOscillator() {
      return { type:"triangle", frequency:{ value:10000 }, connect:()=>{}, start:()=>{}, stop:()=>{} };
    }
    createDynamicsCompressor() {
      return {
        threshold: { value: -50 + audioNoise }, knee: { value: 40 }, ratio: { value: 12 },
        reduction: -20 + audioNoise, attack: { value: 0 }, release: { value: 0.25 },
        connect: () => {},
      };
    }
    async startRendering() {
      const buf = new Float32Array(4096);
      for (let i = 0; i < buf.length; i++) buf[i] = Math.sin(i * 0.01) * audioNoise;
      return { getChannelData: () => buf, length: buf.length, duration: 0.09, sampleRate: 44100 };
    }
  };

  // ── RTCPeerConnection — inject proxy IP so fingerprint matches request IP ─
  const targetIP = proxyIP || `${rand(1,254)}.${rand(1,254)}.${rand(1,254)}.${rand(1,254)}`;
  win.RTCPeerConnection = class RTCPeerConnection {
    constructor() { this._handlers = {}; this.localDescription = null; }
    createDataChannel() { return { close() {} }; }
    async createOffer() { return { type: "offer", sdp: `v=0\r\no=- 1 1 IN IP4 ${targetIP}\r\ns=-\r\n` }; }
    async setLocalDescription(d) {
      this.localDescription = d;
      const cand = { candidate: `candidate:1 1 UDP 2130706431 ${targetIP} ${rand(10000,60000)} typ host`, sdpMid: "0", sdpMLineIndex: 0 };
      setTimeout(() => {
        if (this.onicecandidate) this.onicecandidate({ candidate: cand });
        setTimeout(() => { if (this.onicecandidate) this.onicecandidate({ candidate: null }); }, 10);
      }, 5);
    }
    async addIceCandidate() {}
    close() {}
    get onicecandidate() { return this._handlers.ice; }
    set onicecandidate(fn) { this._handlers.ice = fn; }
  };
  win.RTCSessionDescription = class { constructor(d) { Object.assign(this, d); } };

  // ── Performance / timing ──────────────────────────────────────────────────
  const t0 = Date.now() - rand(5000, 60000);
  const perfObj = {
    now: () => Date.now() - t0,
    timing: { navigationStart: t0, loadEventEnd: t0 + rand(800, 3000) },
    memory: { jsHeapSizeLimit: 2172649472, totalJSHeapSize: dev.heapTotal, usedJSHeapSize: dev.heapUsed },
    getEntriesByType: () => [], mark: () => {}, measure: () => {},
  };
  Object.defineProperty(win, "performance", { get: () => perfObj, configurable: true });

  // ── Date / timezone ────────────────────────────────────────────────────────
  const OrigDate = win.Date;
  win.Date = class extends OrigDate {
    getTimezoneOffset() { return dev.tz; }
  };
  Object.assign(win.Date, OrigDate);

  // ── Misc stubs (direct assignment — safe for non-jsdom-builtin properties) ──
  const _ls = (() => {
    const m = {};
    return { getItem: k => m[k] ?? null, setItem: (k,v) => { m[k] = String(v); },
             removeItem: k => delete m[k], clear: () => { for (const k in m) delete m[k]; },
             get length() { return Object.keys(m).length; } };
  })();
  try { win.localStorage  = _ls; } catch(e) { Object.defineProperty(win, "localStorage",  { get: () => _ls, configurable: true }); }
  try { win.sessionStorage = { getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{}, length:0 }; }
  catch(e) { Object.defineProperty(win, "sessionStorage", { get:()=>({ getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{}, length:0 }), configurable:true }); }

  const _crypto = { getRandomValues: (buf) => { nodeCrypto.randomFillSync(buf); return buf; }, subtle: {} };
  try { win.crypto = _crypto; } catch(e) { Object.defineProperty(win, "crypto", { get: () => _crypto, configurable: true }); }

  win.indexedDB            = { open: () => ({ onsuccess: null, onerror: null, result: null }) };
  win.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  win.cancelAnimationFrame  = (id) => clearTimeout(id);
  win.matchMedia            = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, media: "" });
  win.Notification          = { permission: "default", requestPermission: () => Promise.resolve("denied") };
  win.chrome                = { runtime: {} };
  try { win.visualViewport = { width: innerW, height: innerH, scale: 1, offsetLeft: 0, offsetTop: 0, addEventListener(){} }; }
  catch(e) { Object.defineProperty(win, "visualViewport", { get:()=>({ width:innerW, height:innerH, scale:1, offsetLeft:0, offsetTop:0, addEventListener(){} }), configurable:true }); }
  try { win.Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: pick(["Europe/London","America/New_York","Europe/Berlin","Asia/Tokyo"]) }) }) }; }
  catch(e) {}


  // ── Load Castle SDK ────────────────────────────────────────────────────────
  try {
    win.eval(sdkCode);
  } catch (e) {
    throw new Error(`Castle SDK eval failed: ${e.message}`);
  }

  // NOTE: The SDK exposes window.Castle (capital C)
  if (!win.Castle || typeof win.Castle.configure !== "function") {
    throw new Error("Castle SDK did not expose window.Castle");
  }

  win.Castle.configure({ pk: CASTLE_PK });

  return win;
}

// ── Generate a single castle token ──────────────────────────────────────────
async function generateToken(proxyIP) {
  const sdkCode = fs.readFileSync(SDK_FILE, "utf-8");
  const dev = makeDeviceProfile();
  const win = buildWindow(dev, sdkCode, proxyIP);

  const token = await win.Castle.createRequestToken();
  if (!token || token.length < 20) throw new Error("Empty token from SDK");
  return token;
}

// ── Batch generation with concurrency control ─────────────────────────────────
async function generateBatch(count, maxThreads, proxyIP) {
  const t0      = Date.now();
  const tokens  = [];
  const errors  = [];
  let   pending = 0;
  let   index   = 0;

  if (!STDOUT) {
    console.error(`Castle Engine — ${count} token(s) | threads: ${maxThreads}${proxyIP ? ` | ip: ${proxyIP}` : ""}`);
    console.error(`Generating ${count} unique device fingerprints...`);
  }

  return new Promise((resolve) => {
    function tryNext() {
      while (pending < maxThreads && index < count) {
        const i = index++;
        pending++;
        const t1 = Date.now();
        generateToken(proxyIP)
          .then(token => {
            tokens.push(token);
            if (!STDOUT) console.error(`[${i+1}/${count}] OK (${Date.now()-t1}ms) -> ${token.slice(0,22)}...`);
          })
          .catch(err => {
            errors.push(err.message);
            if (!STDOUT) console.error(`[${i+1}/${count}] FAIL: ${err.message}`);
          })
          .finally(() => {
            pending--;
            tryNext();
            if (pending === 0 && index >= count) {
              if (!STDOUT) {
                console.error("=".repeat(50));
                console.error(`Done: ${tokens.length} ok | ${errors.length} fail | ${Date.now()-t0}ms total`);
                console.error(`Avg: ${Math.round((Date.now()-t0)/count)}ms/token`);
                console.error(`Saved to: ${OUT_FILE}`);
                console.error("=".repeat(50));
              }
              resolve(tokens);
            }
          });
      }
    }
    tryNext();
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(SDK_FILE)) {
    console.error(`ERROR: SDK not found: ${SDK_FILE}`);
    process.exit(1);
  }

  const tokens = await generateBatch(COUNT, Math.min(THREADS, COUNT), PROXY_IP);

  if (STDOUT) {
    // Print only the first token to stdout (used by auth_token.py)
    process.stdout.write((tokens[0] || "") + "\n");
  } else {
    // Save all to file (append mode — each run adds to the pool)
    const existing = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf-8").split("\n").filter(Boolean) : [];
    fs.writeFileSync(OUT_FILE, [...tokens, ...existing].join("\n") + "\n", "utf-8");
  }

  process.exit(tokens.length > 0 ? 0 : 1);
})();
