import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let conversationHistory = [];
let uploadedContext = "";

async function generateWithFallback(contentsParts, systemInstruction) {
  const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.1-pro'];

  for (const modelName of modelsToTry) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        contents: contentsParts,
        config: { systemInstruction }
      });
    } catch (err) {
      if (err.status === 503 || err.code === 503) {
        console.warn(`Model ${modelName} is busy (503). Retrying with next model...`);
        await new Promise(res => setTimeout(res, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("All available Gemini models are currently experiencing high demand. Please wait a moment and try again.");
}

async function generateSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API Error: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

app.post('/api/generate-podcast', upload.array('files'), async (req, res) => {
  try {
    const prompt = req.body.prompt || "Provide an engaging audio lecture based on these materials.";
    const files = req.files || [];

    conversationHistory = [];
    uploadedContext = "";

    const contentsParts = [];

    for (const file of files) {
      if (file.mimetype.startsWith('text/') || file.mimetype === 'application/json') {
        const textContent = file.buffer.toString('utf-8');
        uploadedContext += `\nDocument (${file.originalname}):\n${textContent}\n`;
        contentsParts.push({ text: `Document Content (${file.originalname}):\n${textContent}` });
      } else {
        contentsParts.push({
          inlineData: {
            mimeType: file.mimetype,
            data: file.buffer.toString('base64')
          }
        });
      }
    }

    const systemInstruction = "You are an expert AI tutor creating an interactive podcast/audio lesson. Generate a clear, engaging podcast narration script based on the materials provided.";
    contentsParts.push({ text: `User Prompt: ${prompt}` });

    const response = await generateWithFallback(contentsParts, systemInstruction);
    const generatedScript = response.text;

    conversationHistory.push({ role: 'user', parts: [{ text: `Initial request and files uploaded. Prompt: ${prompt}` }] });
    conversationHistory.push({ role: 'model', parts: [{ text: generatedScript }] });

    const audioBuffer = await generateSpeech(generatedScript);

    res.set({
      'Content-Type': 'audio/mpeg',
      'X-Generated-Text': encodeURIComponent(generatedScript)
    });
    
    res.send(audioBuffer);

  } catch (err) {
    console.error("Error in /api/generate-podcast:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ask-question', upload.single('audio'), async (req, res) => {
  try {
    let userQuery = req.body.question;
    const contentsParts = [];

    if (req.file) {
      contentsParts.push({
        inlineData: {
          mimeType: req.file.mimetype || 'audio/wav',
          data: req.file.buffer.toString('base64')
        }
      });
      contentsParts.push({ text: "Answer the audio question directly and concisely as a tutor." });
    } else if (userQuery) {
      contentsParts.push({ text: userQuery });
    } else {
      return res.status(400).json({ error: "No audio or text question provided." });
    }

    const systemInstruction = "You are an AI tutor maintaining an ongoing voice dialogue. Provide concise, conversational, and direct answers.";
    const response = await generateWithFallback([...conversationHistory.flatMap(c => c.parts), ...contentsParts], systemInstruction);
    const answerText = response.text;

    conversationHistory.push({ role: 'user', parts: contentsParts });
    conversationHistory.push({ role: 'model', parts: [{ text: answerText }] });

    const audioBuffer = await generateSpeech(answerText);

    res.set({
      'Content-Type': 'audio/mpeg',
      'X-Answer-Text': encodeURIComponent(answerText)
    });

    res.send(audioBuffer);

  } catch (err) {
    console.error("Error in /api/ask-question:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});