"use strict";
const fs   = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const nodeCrypto = require("crypto");
const CASTLE_PK = "pk_AvRa79bHyJSYSQHnRpcVtzyxetSvFerx";
const SDK_FILE  = path.join(__dirname, "castle_cdn_sdk.js");
const OUT_FILE  = path.join(__dirname, "castle_token.txt");
const IP_ARG = process.argv.find(a => a.startsWith("--ip="));
const PROXY_IP = IP_ARG ? IP_ARG.split("=")[1] : null;
const rand    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick    = arr => arr[Math.floor(Math.random() * arr.length)];
const randHex = n => nodeCrypto.randomBytes(Math.ceil(n/2)).toString("hex").slice(0, n);
function makeDeviceProfile() {
  const screens = [
    [1920,1080], [1920,1200], [2560,1440], [2560,1600],
    [1680,1050], [1600,900],  [1440,900],  [1366,768],
    [1280,800],  [1280,1024], [2048,1152], [3840,2160],
  ];
  const [sw, sh] = pick(screens);
  const taskbar = pick([40, 48, 56, 60]);
  const gpus = [
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Super Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce GTX 970 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (NVIDIA)", renderer:"ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (AMD)",    renderer:"ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (AMD)",    renderer:"ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (Intel)",  renderer:"ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor:"Google Inc. (Intel)",  renderer:"ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  ];
  const gpu = pick(gpus);
  const chromeVer = "150";
  const cores = pick([2, 4, 6, 8, 10, 12, 16]);
  const mem   = pick([2, 4, 8, 16]);
  const tzOffset = pick([-300, -240, -360, 60, 120]);   
  const canvasNoise = nodeCrypto.randomBytes(32);
  const audioNoise = (Math.random() * 0.0001).toFixed(8);
  const heapUsed  = rand(40, 120) * 1e6;
  const heapTotal = heapUsed + rand(20, 60) * 1e6;
  return { sw, sh, taskbar, gpu, chromeVer, cores, mem, tzOffset, canvasNoise, audioNoise, heapUsed, heapTotal };
}
async function createCastleInstance(sdkCode) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  vc.on("error",      () => {});
  const dev = makeDeviceProfile();
  const UA  = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${dev.chromeVer}.0.0.0 Safari/537.36`;
  const dom = new JSDOM(
    `<!DOCTYPE html><html lang="en"><head></head><body></body></html>`,
    {
      url: "https://x.com/i/jf/onboarding/web",
      pretendToBeVisual: true,
      runScripts: "outside-only",
      virtualConsole: vc,
    }
  );
  const win = dom.window;
  const pluginsArr = Object.assign(
    [
      { name:"Chrome PDF Plugin",   description:"", filename:"chrome_pdf_plugin.dll",              length:0, item:()=>null, namedItem:()=>null },
      { name:"Chrome PDF Viewer",   description:"", filename:"mhjfbmdgcfjbbpaeojofohoefgiehjai.dll",length:0, item:()=>null, namedItem:()=>null },
      { name:"Native Client",       description:"", filename:"internal-nacl-plugin",               length:0, item:()=>null, namedItem:()=>null },
    ],
    { item: i => pluginsArr[i]||null, namedItem: n => pluginsArr.find(p=>p.name===n)||null, refresh:()=>{}, length: 3 }
  );
  const langs = pick([["en-US","en"],["en-GB","en"],["en-US","en","pl"],["pl","pl-PL","en-US","en"]]);
  Object.defineProperty(win, "navigator", {
    value: new Proxy(win.navigator, {
      get(t, p) {
        const ov = {
          userAgent:           UA,
          appVersion:          `5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${dev.chromeVer}.0.0.0 Safari/537.36`,
          platform:            "Win32",
          vendor:              "Google Inc.",
          language:            langs[0],
          languages:           Object.freeze(langs),
          hardwareConcurrency: dev.cores,
          deviceMemory:        dev.mem,
          maxTouchPoints:      0,
          cookieEnabled:       true,
          doNotTrack:          null,
          onLine:              true,
          webdriver:           false,
          product:             "Gecko",
          productSub:          "20030107",
          appName:             "Netscape",
          appCodeName:         "Mozilla",
          plugins:             pluginsArr,
          mimeTypes:           { length:0, item:()=>null, namedItem:()=>null },
          sendBeacon:          ()=>true,
          permissions:         { query: ()=>Promise.resolve({state:"prompt",addEventListener(){}}) },
          mediaDevices:        { enumerateDevices: ()=>Promise.resolve([]) },
          getBattery:          ()=>Promise.resolve({charging:true,level:1,chargingTime:0,dischargingTime:Infinity,addEventListener(){}}),
          connection:          { effectiveType:"4g", downlink:rand(5,100), rtt:rand(10,80), saveData:false, addEventListener(){}, onchange:null },
          oscpu:               undefined,
          cpuClass:            undefined,
          geolocation:         { getCurrentPosition:(_,e)=>e&&e({code:1,message:"denied"}) },
        };
        if (p in ov) return ov[p];
        const v = t[p];
        return typeof v === "function" ? v.bind(t) : v;
      },
      has: () => true,
    }),
    writable: false, configurable: true,
  });
  Object.defineProperty(win, "screen", {
    value: {
      width:       dev.sw,
      height:      dev.sh,
      availWidth:  dev.sw,
      availHeight: dev.sh - dev.taskbar,
      colorDepth:  24,
      pixelDepth:  24,
      orientation: { type:"landscape-primary", angle:0, addEventListener(){}, removeEventListener(){} },
    },
    writable: false, configurable: true,
  });
  const innerH = dev.sh - dev.taskbar - rand(60, 110);   
  win.devicePixelRatio = pick([1, 1, 1, 1.25, 1.5, 2]);
  win.innerWidth  = dev.sw;
  win.innerHeight = innerH;
  win.outerWidth  = dev.sw;
  win.outerHeight = dev.sh - dev.taskbar;
  win.screenX = 0;
  win.screenY = 0;
  const _origDate = win.Date;
  const tzOff = dev.tzOffset;
  win.Date = class extends _origDate {
    getTimezoneOffset() { return tzOff; }
  };
  win.Date.now = _origDate.now.bind(_origDate);
  Object.defineProperty(win, "crypto", {
    value: {
      getRandomValues(arr) {
        const b = nodeCrypto.randomBytes(arr.byteLength || arr.length);
        for (let i=0; i<arr.length; i++) arr[i] = b[i];
        return arr;
      },
      subtle: {
        digest:      (a,d) => Promise.resolve(nodeCrypto.createHash("sha256").update(Buffer.from(d)).digest().buffer),
        importKey:   ()    => Promise.resolve({}),
        sign:        ()    => Promise.resolve(new ArrayBuffer(32)),
        verify:      ()    => Promise.resolve(true),
        generateKey: ()    => Promise.resolve({}),
        deriveKey:   ()    => Promise.resolve({}),
        deriveBits:  ()    => Promise.resolve(new ArrayBuffer(32)),
        encrypt:     ()    => Promise.resolve(new ArrayBuffer(32)),
        decrypt:     ()    => Promise.resolve(new ArrayBuffer(0)),
      },
      randomUUID: () => nodeCrypto.randomUUID(),
    },
    writable: true, configurable: true,
  });
  const mkStorage = () => {
    const s = {};
    return {
      getItem:    k   => s[k] ?? null,
      setItem:    (k,v) => { s[k] = String(v); },
      removeItem: k   => { delete s[k]; },
      clear:      ()  => { for (const k in s) delete s[k]; },
      get length()    { return Object.keys(s).length; },
      key:        i   => Object.keys(s)[i] ?? null,
    };
  };
  Object.defineProperty(win, "localStorage",  { value: mkStorage(), writable:true, configurable:true });
  Object.defineProperty(win, "sessionStorage", { value: mkStorage(), writable:true, configurable:true });
  win.TextEncoder = TextEncoder;
  win.TextDecoder = TextDecoder;
  win.chrome = {
    runtime: {
      onMessage:   { addListener(){}, removeListener(){} },
      onConnect:   { addListener(){} },
      sendMessage(){},
      getManifest: () => ({ version:`${dev.chromeVer}.0.0.0` }),
      connect:     () => ({ postMessage(){}, onMessage:{ addListener(){} } }),
      id: undefined,
    },
    loadTimes: () => ({}),
    csi:       () => ({}),
    app: { isInstalled: false },
  };
  const noise = dev.canvasNoise;   
  const _origCreate = win.document.createElement.bind(win.document);
  win.document.createElement = function(tag, opts) {
    const el = _origCreate(tag, opts);
    if (tag === "canvas" && !el.getContext) {
      el.width  = 300;
      el.height = 150;
      el.getContext = type => {
        if (type === "2d") return {
          fillStyle:"#000", font:"10px sans-serif", textBaseline:"alphabetic",
          globalCompositeOperation:"source-over", strokeStyle:"#000",
          lineWidth:1, shadowBlur:0, shadowColor:"", globalAlpha:1,
          fillRect(){}, fillText(){}, clearRect(){}, beginPath(){}, arc(){}, fill(){},
          stroke(){}, save(){}, restore(){}, translate(){}, rotate(){}, scale(){},
          moveTo(){}, lineTo(){}, closePath(){}, rect(){}, clip(){}, setTransform(){},
          measureText: t => ({ width: t.length*7 + noise[0]*0.01, actualBoundingBoxAscent:10, actualBoundingBoxDescent:2 }),
          createLinearGradient: () => ({ addColorStop(){} }),
          getImageData: (x,y,w,h) => {
            const data = new Uint8ClampedArray(w*h*4);
            for (let i=0; i<Math.min(noise.length, data.length); i++) data[i] = noise[i % noise.length];
            return { data, width:w, height:h };
          },
          putImageData(){}, drawImage(){}, createPattern:()=>null,
          canvas: el,
          toDataURL: () => `data:image/png;base64,${noise.toString("base64")}`,
        };
        if (type==="webgl" || type==="experimental-webgl" || type==="webgl2") return {
          RENDERER:7937, VENDOR:7936, VERSION:7938, SHADING_LANGUAGE_VERSION:35724,
          UNMASKED_RENDERER_WEBGL:37446, UNMASKED_VENDOR_WEBGL:37445,
          getParameter(p) {
            return ({
              7936: dev.gpu.vendor,
              7937: dev.gpu.renderer,
              7938: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
              35724:"WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
              37445: dev.gpu.vendor,
              37446: dev.gpu.renderer,
              35672:16, 34921:16, 36347:256, 36348:224,
              3379:16384, 3386:new Int32Array([32767,32767]),
              3410:8, 3411:8, 3412:8, 3413:8, 3414:24, 3415:8,
            })[p] ?? null;
          },
          getExtension(n) {
            if (n==="WEBGL_debug_renderer_info") return {UNMASKED_VENDOR_WEBGL:37445, UNMASKED_RENDERER_WEBGL:37446};
            if (n==="EXT_texture_filter_anisotropic" || n==="WEBKIT_EXT_texture_filter_anisotropic") return {MAX_TEXTURE_MAX_ANISOTROPY_EXT:0x84FF};
            if (n==="OES_vertex_array_object") return {createVertexArrayOES(){return{};},bindVertexArrayOES(){},deleteVertexArrayOES(){}};
            return {};
          },
          getSupportedExtensions: () => [
            "ANGLE_instanced_arrays","EXT_blend_minmax","EXT_frag_depth","EXT_texture_filter_anisotropic",
            "OES_element_index_uint","OES_standard_derivatives","OES_texture_float","OES_texture_half_float",
            "OES_vertex_array_object","WEBGL_debug_renderer_info","WEBGL_depth_texture","WEBGL_draw_buffers",
          ],
          createBuffer(){return{};}, bindBuffer(){}, bufferData(){},
          createProgram(){return{};}, createShader(){return{};},
          shaderSource(){}, compileShader(){}, attachShader(){}, linkProgram(){},
          useProgram(){}, getAttribLocation:()=>0, getUniformLocation:()=>({}),
          getShaderParameter:()=>true, getProgramParameter:()=>true,
          enable(){}, disable(){}, viewport(){}, clear(){}, clearColor(){},
          drawArrays(){}, drawElements(){},
          vertexAttribPointer(){}, enableVertexAttribArray(){},
          deleteBuffer(){}, deleteProgram(){}, deleteShader(){},
          isContextLost:()=>false, canvas:el,
        };
        return null;
      };
    }
    return el;
  };
  const aNoise = parseFloat(dev.audioNoise);
  const mkAudio = () => ({
    destination:{}, sampleRate:44100, state:"running",
    currentTime: Math.random() * 500 + 100,
    createOscillator: () => ({
      type:"sine", frequency:{value:440+aNoise,setValueAtTime(){}},
      connect(){return this;}, start(){}, stop(){}, disconnect(){}
    }),
    createDynamicsCompressor: () => ({
      threshold:{value:-24+aNoise}, knee:{value:30}, ratio:{value:12},
      attack:{value:0.003}, release:{value:0.25},
      connect(){return this;}, disconnect(){}
    }),
    createGain: () => ({ gain:{value:1,setValueAtTime(){}}, connect(){return this;}, disconnect(){} }),
    createAnalyser: () => ({
      fftSize:2048, frequencyBinCount:1024,
      getFloatFrequencyData(a) { for(let i=0;i<a.length;i++) a[i]=-100+Math.random()*2+aNoise; },
      connect(){return this;}, disconnect(){}
    }),
    createBuffer:       (c,l,sr) => ({numberOfChannels:c,length:l,sampleRate:sr,getChannelData:()=>new Float32Array(l).fill(aNoise)}),
    createBufferSource: ()       => ({buffer:null,connect(){return this;},start(){},stop(){},disconnect(){}}),
    createScriptProcessor: ()    => ({onaudioprocess:null,connect(){return this;},disconnect(){}}),
    close: () => Promise.resolve(),
    addEventListener(){}, removeEventListener(){},
  });
  win.AudioContext        = class { constructor() { return mkAudio(); } };
  win.webkitAudioContext  = win.AudioContext;
  win.OfflineAudioContext = class {
    constructor(ch, len, sr) { this._len=len; this.destination={}; this.sampleRate=sr; }
    createOscillator()        { return {type:"triangle",frequency:{value:10000+aNoise,setValueAtTime(){}},connect(){return this;},start(){},stop(){}};  }
    createDynamicsCompressor(){ return {connect(){return this;}}; }
    startRendering()          { return Promise.resolve({getChannelData:()=>new Float32Array(this._len).fill(0.5+aNoise)}); }
  };
  if (win.performance) {
    win.performance.memory = {
      usedJSHeapSize:  dev.heapUsed,
      totalJSHeapSize: dev.heapTotal,
      jsHeapSizeLimit: 4294705152,
    };
  }
  win.fetch       = () => Promise.resolve({ ok:false, status:0, json:()=>Promise.resolve({}), text:()=>Promise.resolve(""), headers:{get:()=>null} });
  win.matchMedia  = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, media:"" });
  win.visualViewport = { width:dev.sw, height:innerH, scale:1, offsetLeft:0, offsetTop:0, addEventListener(){} };
  const targetIP = PROXY_IP || `${rand(1,254)}.${rand(1,254)}.${rand(1,254)}.${rand(1,254)}`;
  win.RTCPeerConnection = class {
    constructor() {
      this._handlers = {};
      this.localDescription = null;
      this.remoteDescription = null;
    }
    createDataChannel() { return { close(){} }; }
    async createOffer()  { return { type:"offer", sdp:`v=0\r\no=- 1234 1 IN IP4 ${targetIP}\r\ns=-\r\n` }; }
    async setLocalDescription(desc) {
      this.localDescription = desc;
      const candidate = {
        candidate: `candidate:1 1 UDP 2130706431 ${targetIP} ${rand(10000,60000)} typ host`,
        sdpMid: "0", sdpMLineIndex: 0,
      };
      setTimeout(() => {
        if (this.onicecandidate) this.onicecandidate({ candidate });
        setTimeout(() => { if (this.onicecandidate) this.onicecandidate({ candidate: null }); }, 10);
      }, 5);
    }
    async setRemoteDescription(desc) { this.remoteDescription = desc; }
    async addIceCandidate() {}
    close() {}
    addEventListener(ev, fn) { this._handlers[ev] = fn; }
    removeEventListener() {}
    get onicecandidate() { return this._handlers["icecandidate"]; }
    set onicecandidate(fn) { this._handlers["icecandidate"] = fn; }
  };
  win.RTCSessionDescription = class { constructor(d){ Object.assign(this,d); } };
  try {
    win.eval(sdkCode);
  } catch(e) {
  }
  const castle = win.Castle;
  if (!castle || typeof castle.configure !== "function") {
    throw new Error(`Castle not exported. Keys: ${castle ? Object.keys(castle) : "null"}`);
  }
  try {
    await castle.configure({ pk: CASTLE_PK });
  } catch(e) {}
  await new Promise(r => setTimeout(r, 200));
  return { castle, dom };
}
async function generateToken(castle) {
  const token = await castle.createRequestToken();
  if (!token || typeof token !== "string") throw new Error(`Invalid token: ${JSON.stringify(token)}`);
  return token;
}
async function main() {
  const args    = process.argv.slice(2);
  const count   = parseInt(args.find(a => /^\d+$/.test(a)) || "1");
  const stdout  = args.includes("--stdout");
  const threads = parseInt((args.find(a => a.startsWith("--threads=")) || "").split("=")[1] || (args[args.indexOf("--threads")+1] || "1"));
  if (!stdout) {
    process.stderr.write(`Castle Engine (jsdom+randomized fingerprints) — ${count} token(s) | threads: ${threads}\n`);
  }
  const sdkCode = fs.readFileSync(SDK_FILE, "utf8");
  if (!stdout) fs.writeFileSync(OUT_FILE, "", "utf8");
  const start = Date.now();
  let ok = 0, fail = 0;
  const workerCount = Math.min(threads, count);
  if (!stdout) process.stderr.write(`Creating ${count} unique device fingerprints...\n`);
  const tasks = Array.from({ length: count }, (_, i) => async () => {
    const t = Date.now();
    let inst = null;
    try {
      inst = await createCastleInstance(sdkCode);   
      const token = await generateToken(inst.castle);
      const ms = Date.now() - t;
      if (stdout) {
        process.stdout.write(token + "\n");
      } else {
        fs.appendFileSync(OUT_FILE, token + "\n", "utf8");
        process.stdout.write(`[${i+1}/${count}] OK (${ms}ms) -> ${token.substring(0,22)}...\n`);
      }
      ok++;
    } catch(e) {
      const ms = Date.now() - t;
      if (!stdout) process.stderr.write(`[${i+1}/${count}] FAIL (${ms}ms): ${e.message}\n`);
      fail++;
    } finally {
      if (inst) try { inst.dom.window.close(); } catch(_) {}
    }
  });
  for (let i = 0; i < tasks.length; i += workerCount) {
    await Promise.all(tasks.slice(i, i + workerCount).map(t => t()));
  }
  if (!stdout) {
    const total = Date.now() - start;
    process.stderr.write(`\n${"=".repeat(50)}\n`);
    process.stderr.write(`Done: ${ok} ok | ${fail} fail | ${total}ms total\n`);
    process.stderr.write(`Avg: ${Math.round(total/count)}ms/token\n`);
    if (ok > 0) process.stderr.write(`Saved to: ${OUT_FILE}\n`);
    process.stderr.write(`${"=".repeat(50)}\n`);
  }
  if (fail > 0 && ok === 0) process.exit(1);
}
main().catch(e => { process.stderr.write(`Fatal: ${e.stack}\n`); process.exit(1); });
