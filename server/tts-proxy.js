const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = Number(process.env.TTS_PROXY_PORT || 8788);
const geminiKey = process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const voiceEn = process.env.TTS_VOICE_EN || 'Kore';
const voiceAr = process.env.TTS_VOICE_AR || 'Puck';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function pcmToWavBase64(pcmBase64, sampleRate) {
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]).toString('base64');
}

function normalizeAudioPayload(audioBase64, mimeType) {
  if (!audioBase64) return null;

  if (/^audio\/L16/i.test(mimeType || '')) {
    const rateMatch = /rate=(\d+)/i.exec(mimeType || '');
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    return {
      audioBase64: pcmToWavBase64(audioBase64, sampleRate),
      mimeType: 'audio/wav',
    };
  }

  return { audioBase64, mimeType: mimeType || 'audio/wav' };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'gemini-tts-proxy' });
});

app.post('/api/tts', async (req, res) => {
  if (!geminiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY in server env' });
  }

  const text = String(req.body?.text || '').trim();
  const lang = req.body?.lang === 'ar' ? 'ar' : 'en';

  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const voiceName = lang === 'ar' ? voiceAr : voiceEn;
  const styledText = lang === 'ar'
    ? `نبرة مرحة وروبوتية خفيفة مثل جهاز ألعاب صغير: ${text}`
    : `Playful tiny retro game-console robot voice: ${text}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: styledText,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || data?.error) {
      const message = data?.error?.message || `Gemini TTS error: HTTP ${response.status}`;
      return res.status(502).json({ error: message, details: data?.error || null });
    }

    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const audioPart = parts.find((part) => part?.inlineData?.data);
    const audioBase64 = audioPart?.inlineData?.data;
    const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

    if (!audioBase64) {
      return res.status(502).json({
        error: 'Gemini TTS returned no audio payload',
        finishReason: candidate?.finishReason || null,
      });
    }

    const normalized = normalizeAudioPayload(audioBase64, mimeType);
    if (!normalized) {
      return res.status(502).json({ error: 'Gemini TTS normalization failed' });
    }

    return res.json(normalized);
  } catch (error) {
    return res.status(500).json({ error: error?.message || String(error) });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Gemini TTS proxy listening on http://0.0.0.0:${port}`);
});
