const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// 4 Rotating WhatsApp Slots
const waSlots = {
  1: { sock: null, status: 'disconnected', qr: null },
  2: { sock: null, status: 'disconnected', qr: null },
  3: { sock: null, status: 'disconnected', qr: null },
  4: { sock: null, status: 'disconnected', qr: null }
};
let currentSlot = 1;

async function startWhatsApp(slot) {
  const authDir = path.join(__dirname, `auth_slot_${slot}`);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' })
  });

  waSlots[slot].sock = sock;
  waSlots[slot].status = 'connecting';

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      waSlots[slot].qr = await QRCode.toDataURL(qr);
      waSlots[slot].status = 'qr_ready';
    }
    if (connection === 'open') {
      waSlots[slot].status = 'connected';
      waSlots[slot].qr = null;
    } else if (connection === 'close') {
      waSlots[slot].status = 'disconnected';
      waSlots[slot].qr = null;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(() => startWhatsApp(slot), 5000);
    }
  });
}

// Health Check (For 24/7 Cron-Job)
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// WhatsApp Status & Connect
app.get('/api/wa/status', (req, res) => {
  const data = {};
  for (let i = 1; i <= 4; i++) {
    data[i] = { status: waSlots[i].status, qr: waSlots[i].qr };
  }
  res.json(data);
});

app.post('/api/wa/connect/:slot', async (req, res) => {
  const slot = Number(req.params.slot);
  if (!waSlots[slot]) return res.status(400).json({ error: 'Invalid slot' });
  await startWhatsApp(slot);
  res.json({ ok: true, message: `Slot ${slot} starting...` });
});

// Send WhatsApp via Rotating Connected Slot
app.post('/api/wa/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'Phone and message required' });

  const cleanPhone = phone.replace(/\D/g, '') + '@s.whatsapp.net';
  for (let i = 0; i < 4; i++) {
    const slot = ((currentSlot - 1 + i) % 4) + 1;
    if (waSlots[slot].status === 'connected' && waSlots[slot].sock) {
      try {
        await waSlots[slot].sock.sendMessage(cleanPhone, { text: message });
        currentSlot = (slot % 4) + 1;
        return res.json({ ok: true, usedSlot: slot });
      } catch (e) {
        console.error(`Slot ${slot} failed:`, e.message);
      }
    }
  }
  res.status(503).json({ error: 'No connected WhatsApp slot available' });
});

// Pakistani Urdu AI Voice (Microsoft Edge TTS)
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice || 'ur-PK-UzmaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const readable = tts.toStream(text);

    res.setHeader('Content-Type', 'audio/mpeg');
    readable.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`TAK QR Clinic Soft running on port ${PORT}`));

