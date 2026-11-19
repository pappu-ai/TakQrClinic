const crypto = require("crypto");
const https = require("https");
const WebSocket = require("ws");

function getSecMsGec() {
  const ticks =
    (BigInt(Math.floor(Date.now() / 1000) + 11644473600) / 300n) *
    300n *
    10000000n;
  return crypto
    .createHash("sha256")
    .update(ticks.toString() + "6A5AA1D4EAFF4E9FB37E23D68491D6F4")
    .digest("hex")
    .toUpperCase();
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function edgeTTS(text, voiceName) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID().replace(/-/g, "");
    const secMsGec = getSecMsGec();
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${requestId}`;

    const ws = new WebSocket(url, {
      headers: {
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
      }
    });

    const chunks = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Edge TTS timeout"));
    }, 8000);

    ws.on("open", () => {
      const ts = new Date().toISOString();
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      );
      ws.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ur-PK'><voice name='${voiceName}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`
      );
    });

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        if (data.toString("utf8").includes("Path:turn.end")) {
          clearTimeout(timer);
          ws.close();
          resolve(Buffer.concat(chunks));
        }
        return;
      }
      const buf = Buffer.from(data);
      if (buf.length > 2) {
        const headerLen = buf.readUInt16BE(0);
        if (buf.length > 2 + headerLen) {
          const header = buf.subarray(2, 2 + headerLen).toString("utf8");
          if (header.includes("Path:audio")) {
            chunks.push(buf.subarray(2 + headerLen));
          }
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timer);
      if (chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error("No audio received"));
    });
  });
}

function fallbackUrduTTS(text) {
  return new Promise((resolve, reject) => {
    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=ur&q=${encodeURIComponent(text.slice(0, 200))}`;
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (resp) => {
        if (resp.statusCode !== 200) {
          return reject(new Error("Fallback status " + resp.statusCode));
        }
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }

  const text =
    (req.query && req.query.text) ||
    body.text ||
    "السلام علیکم، تک کیو آر کلینک میں خوش آمدید۔";
  const voiceParam = ((req.query && req.query.voice) || body.voice || "uzma")
    .toString()
    .toLowerCase();
  const voiceName =
    voiceParam === "asad" ? "ur-PK-AsadNeural" : "ur-PK-UzmaNeural";

  try {
    let audioBuffer;
    try {
      audioBuffer = await edgeTTS(text, voiceName);
    } catch (e) {
      audioBuffer = await fallbackUrduTTS(text);
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(audioBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Voice failed" });
  }
};
