const http = require("http");
const fs = require("fs");
const path = require("path");

const SDK_FILE = path.join(__dirname, "castle_cdn_sdk.js");
const sdkCode = fs.readFileSync(SDK_FILE, "utf8");

const engine = require("./castle_engine_final.js");

const queue = [];
let running = 0;
const MAX_CONCURRENT = 2;

function processQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    running++;
    (async () => {
      let inst = null;
      try {
        inst = await engine.createCastleInstance(sdkCode, item.ip);
        const token = await engine.generateToken(inst.castle);
        item.resolve(token);
      } catch (err) {
        item.reject(err);
      } finally {
        if (inst) {
          try { inst.dom.window.close(); } catch (_) {}
        }
        running--;
        processQueue();
      }
    })();
  }
}

function queueToken(ip) {
  return new Promise((resolve, reject) => {
    queue.push({ ip, resolve, reject });
    processQueue();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && (req.url === "/android/twitter/castle" || req.url === "/api/Castle/generate-token")) {
    let bodyStr = "";
    req.on("data", chunk => { bodyStr += chunk; });
    req.on("end", async () => {
      let ip = null;
      try {
        if (bodyStr) {
          const parsed = JSON.parse(bodyStr);
          ip = parsed.ip || null;
        }
      } catch (e) {}

      try {
        const token = await queueToken(ip);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: token, length: token.length }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Generation failed: " + err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/android/twitter/castle/batch") {
    let bodyStr = "";
    req.on("data", chunk => { bodyStr += chunk; });
    req.on("end", async () => {
      let ips = [];
      try {
        if (bodyStr) {
          const parsed = JSON.parse(bodyStr);
          ips = Array.isArray(parsed.ips) ? parsed.ips : [];
        }
      } catch (e) {}

      if (ips.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Missing or empty 'ips' list" }));
        return;
      }

      try {
        const results = await Promise.all(ips.map(async ip => {
          try {
            const token = await queueToken(ip);
            return { ip: ip, token: token, success: true };
          } catch (err) {
            return { ip: ip, token: null, success: false, error: err.message };
          }
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tokens: results, count: results.length }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: err.message }));
      }
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", queue_length: queue.length, running: running }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ detail: "Not found" }));
});

const PORT = parseInt(process.env.CASTLE_PORT || "8001");
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Castle queued worker listening on port ${PORT}\n`);
});
