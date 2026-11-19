const crypto = require("crypto");
const WebSocket = require("ws");

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_VER = "143.0.3650.75";

function getSecMsGec() {
  const unixSec = BigInt(Math.floor(Date.now() / 1000));
  let ticks = unixSec + 11644473600n;
  ticks = (ticks - (ticks % 300n)) * 10000000n;
  return crypto
    .createHash("sha256")
    .update(ticks.toString() + TOKEN)
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
    const muid = crypto.randomBytes(16).toString("hex").toUpperCase();
    const secMsGec = getSecMsGec();
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-${CHROMIUM_VER}&ConnectionId=${requestId}`;

    const ws = new WebSocket(url, {
      headers: {
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: `muid=${muid};`
      }
    });

    const chunks = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Edge TTS timeout"));
    }, 10000);

    ws.on("open", () => {
      const ts = new Date().toString();
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
      );
      ws.send(
        `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voiceName}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`
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

    ws.on("close", (code) => {
      clearTimeout(timer);
      if (chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error("Closed with no audio, code: " + code));
    });
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

  let rawText =
    (req.query && req.query.text) ||
    body.text ||
    "السلام علیکم، تک کیو آر کلینک میں خوش آمدید۔";
  try {
    if (rawText.includes("%")) rawText = decodeURIComponent(rawText);
  } catch (e) {}
  const text = rawText.replace(/%20/g, " ").trim();

  const voiceParam = ((req.query && req.query.voice) || body.voice || "uzma")
    .toString()
    .toLowerCase();
  const voiceName =
    voiceParam === "asad" ? "ur-PK-AsadNeural" : "ur-PK-UzmaNeural";

  try {
    const audioBuffer = await edgeTTS(text, voiceName);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(audioBuffer);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Voice failed" });
  }
};
