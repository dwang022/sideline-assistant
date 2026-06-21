import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI, { toFile } from "openai";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: "1mb" }));

const uploadDir = path.join(process.cwd(), ".tmp_uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PARSER_MODEL = process.env.OPENAI_PARSER_MODEL || "gpt-4o-mini";
const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";

const SITUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["twopoint", "penalty", "clock"] },
    confidence: { type: "number" },
    corrected_transcript: { type: "string" },
    missing_fields: { type: "array", items: { type: "string" } },
    twopoint: {
      type: "object",
      additionalProperties: false,
      properties: {
        score_margin_after_td: { type: ["integer", "null"] },
        quarter: { type: ["integer", "null"] },
        clock_seconds: { type: ["integer", "null"] }
      },
      required: ["score_margin_after_td", "quarter", "clock_seconds"]
    },
    penalty: {
      type: "object",
      additionalProperties: false,
      properties: {
        side: { type: "string", enum: ["offense", "defense", "unknown"] },
        penalty_down: { type: ["integer", "null"] },
        penalty_distance: { type: ["integer", "null"] },
        play_result_down: { type: ["integer", "null"] },
        play_result_distance: { type: ["integer", "null"] }
      },
      required: ["side", "penalty_down", "penalty_distance", "play_result_down", "play_result_distance"]
    },
    clock: {
      type: "object",
      additionalProperties: false,
      properties: {
        score_margin: { type: ["integer", "null"] },
        clock_seconds: { type: ["integer", "null"] },
        opponent_timeouts: { type: ["integer", "null"] }
      },
      required: ["score_margin", "clock_seconds", "opponent_timeouts"]
    }
  },
  required: ["mode", "confidence", "corrected_transcript", "missing_fields", "twopoint", "penalty", "clock"]
};


function audioExtFromMime(mime = "", originalName = "") {
  const lowerMime = String(mime).toLowerCase();
  const lowerName = String(originalName).toLowerCase();

  if (lowerName.endsWith(".webm")) return "webm";
  if (lowerName.endsWith(".mp4")) return "mp4";
  if (lowerName.endsWith(".m4a")) return "m4a";
  if (lowerName.endsWith(".mp3")) return "mp3";
  if (lowerName.endsWith(".wav")) return "wav";
  if (lowerName.endsWith(".mpeg")) return "mpeg";
  if (lowerName.endsWith(".mpga")) return "mpga";

  if (lowerMime.includes("webm")) return "webm";
  if (lowerMime.includes("mp4")) return "mp4";
  if (lowerMime.includes("x-m4a") || lowerMime.includes("m4a")) return "m4a";
  if (lowerMime.includes("mpeg")) return "mp3";
  if (lowerMime.includes("mp3")) return "mp3";
  if (lowerMime.includes("wav")) return "wav";

  return "webm";
}

function systemPrompt(selectedMode) {
  return `
You are a football sideline parsing assistant.

Your only job is to convert messy coach speech/text into structured fields for a deterministic chart app.
Do NOT make the recommendation. Do NOT decide go/kick/accept/decline/kneel. Only extract inputs.

Selected mode: ${selectedMode}
The returned "mode" should normally equal the selected mode unless the transcript is clearly for a different chart.

Football interpretation rules:
- "up 4" = score_margin +4. "down 6" = score_margin -6.
- For two-point: score_margin_after_td is the margin AFTER the touchdown, BEFORE the PAT/XP.
- In selected twopoint mode, if the coach says a margin like "up 8", "down 2", or "tied" without saying "after the TD", assume that IS the post-touchdown, pre-PAT margin.
- Do not require the phrase "after the touchdown". Only treat the margin as pre-touchdown if the coach explicitly says "before the touchdown", "before we scored", or similar.
- For clock: clock_seconds is the time left when the first-down snap/play is run. opponent_timeouts means THEIR timeouts.
- For penalty: penalty_down/distance is the result if the penalty is accepted. play_result_down/distance is what you keep if declining.
- "first", "second", "third", "fourth" can mean 1, 2, 3, 4 for downs/quarters.
- "two forty", "2 40", "240", or "two fourty" should mean 2:40 = 160 seconds when spoken as a clock.
- Speech errors to correct:
  - "up for 240" usually means "up 4, 2:40 left".
  - "a pound has two timeouts" usually means "opponent has two timeouts".
  - "penalty give second and 15" means "penalty gives 2nd and 15".
  - "play result is third and eight" means "play result is 3rd and 8".
- If a required field is missing or truly unclear, set it to null and list it in missing_fields.
`.trim();
}

async function extractSituation({ mode, transcript }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.");
  }

  const completion = await openai.chat.completions.create({
    model: PARSER_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt(mode) },
      { role: "user", content: `Selected mode: ${mode}\nTranscript: ${transcript}` }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sideline_situation",
        strict: true,
        schema: SITUATION_SCHEMA
      }
    }
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error("No structured response returned by OpenAI.");
  return JSON.parse(content);
}

app.post("/api/parse-situation", async (req, res) => {
  try {
    const mode = req.body?.mode;
    const transcript = req.body?.transcript;

    if (!["twopoint", "penalty", "clock"].includes(mode)) {
      return res.status(400).send("Invalid mode.");
    }
    if (!transcript || typeof transcript !== "string") {
      return res.status(400).send("Missing transcript.");
    }

    const parsed = await extractSituation({ mode, transcript });
    res.json({ parsed });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message || "AI parser failed.");
  }
});

app.post("/api/transcribe-situation", upload.single("audio"), async (req, res) => {
  try {
    const mode = req.body?.mode;
    if (!["twopoint", "penalty", "clock"].includes(mode)) {
      return res.status(400).send("Invalid mode.");
    }
    if (!req.file) {
      return res.status(400).send("Missing audio.");
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).send("OPENAI_API_KEY is not set. Add it to .env.");
    }

    const audioBuffer = await fs.promises.readFile(req.file.path);
    const ext = audioExtFromMime(req.file.mimetype, req.file.originalname);
    const audioFile = await toFile(audioBuffer, `sideline-audio.${ext}`);

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: TRANSCRIBE_MODEL,
      response_format: "json",
      prompt:
        "Football sideline decision audio. Terms may include two-point, extra point, XP, penalty, accept, decline, offense, defense, down and distance, up 4, down 6, 2:40 left, opponent timeouts.",
    });

    const transcript =
      typeof transcription === "string" ? transcription : transcription.text;

    const parsed = await extractSituation({ mode, transcript });

    res.json({ transcript, parsed });
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message || "AI audio parser failed.");
  } finally {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
  }
});


const distPath = path.join(process.cwd(), "dist");

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get(/.*/, (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).send("API route not found.");
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Sideline AI parser server running on http://localhost:${PORT}`);
});
