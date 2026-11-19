const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const text = (req.query && req.query.text) || body.text || "السلام علیکم، تک کیو آر کلینک میں خوش آمدید۔";
  const voiceParam = ((req.query && req.query.voice) || body.voice || "uzma").toString().toLowerCase();
  const voiceName = voiceParam === "asad" ? "ur-PK-AsadNeural" : "ur-PK-UzmaNeural";

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const streamResult = tts.toStream(text);
    const audioStream = streamResult.audioStream || streamResult;
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on("data", (chunk) => chunks.push(chunk));
      audioStream.on("end", resolve);
      audioStream.on("error", reject);
    });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.concat(chunks));
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Voice failed" });
  } finally {
    if (typeof tts.close === "function") try { tts.close(); } catch (e) {}
  }
};
