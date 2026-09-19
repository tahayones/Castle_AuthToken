const http = require("http");
const fs = require("fs");
const path = require("path");

const SDK_FILE = path.join(__dirname, "castle_cdn_sdk.js");
const sdkCode = fs.readFileSync(SDK_FILE, "utf8");

const engine = require("./castle_engine_final.js");

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
        const inst = await engine.createCastleInstance(sdkCode, ip);
        const token = await engine.generateToken(inst.castle);
        try { inst.dom.window.close(); } catch (_) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ token: token, length: token.length }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Generation failed: " + err.message }));
      }
    });
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ detail: "Not found" }));
});

const PORT = parseInt(process.env.CASTLE_PORT || "8001");
server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Castle internal worker listening on port ${PORT}\n`);
});
