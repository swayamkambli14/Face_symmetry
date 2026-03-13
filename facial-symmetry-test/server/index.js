const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const FormData = require("form-data");

const app = express();
const PORT = process.env.PORT || 5000;
const CV_ENGINE_URL = process.env.CV_ENGINE_URL || "http://localhost:8000";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({
  origin: [CLIENT_URL, "http://localhost:5173"],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true
}));
app.use(express.json());

// ── Storage ──────────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const prefix = req.path.includes("baseline") ? "baseline" : "test";
    cb(null, `${prefix}_${Date.now()}.jpg`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

// ── In-memory fingerprint (no filesystem dependency) ─────────────────────────
let fingerprintData = null;
let baselineScores = null;

// ── CV Engine HTTP Client ─────────────────────────────────────────────────────
async function callCVEngine(imagePath, mode, fpData = null) {
  const formData = new FormData();
  formData.append("mode", mode);
  formData.append("image", fs.createReadStream(imagePath));

  if (mode === "analyze" && fpData) {
    formData.append("fingerprint_data", fpData);
  }

  const response = await fetch(`${CV_ENGINE_URL}/analyze`, {
    method: "POST",
    body: formData,
    headers: formData.getHeaders(),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`CV Engine error ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`CV engine returned non-JSON: ${text}`);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/baseline
app.post("/api/baseline", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  try {
    const result = await callCVEngine(req.file.path, "baseline");

    if (result.error) return res.status(422).json({ error: result.error });

    // Store fingerprint in memory instead of filesystem
    fingerprintData = result.fingerprint_data || null;
    baselineScores = result.scores || null;

    res.json({
      success: true,
      message: "Baseline saved",
      scores: result.scores,
      meta: result.meta,
    });
  } catch (err) {
    console.error("Baseline error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze
app.post("/api/analyze", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  if (!fingerprintData) {
    return res.status(400).json({ error: "No baseline found. Upload baseline photo first." });
  }

  try {
    const result = await callCVEngine(req.file.path, "analyze", fingerprintData);

    if (result.error) return res.status(422).json({ error: result.error });

    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status
app.get("/api/status", (req, res) => {
  res.json({
    hasBaseline: !!fingerprintData,
    baselineScores: baselineScores
      ? Object.fromEntries(
          Object.entries(baselineScores).filter(([k, v]) => typeof v === "number")
        )
      : null,
  });
});

// DELETE /api/reset
app.delete("/api/reset", (req, res) => {
  try {
    fingerprintData = null;
    baselineScores = null;
    const files = fs.readdirSync(UPLOADS_DIR);
    files.forEach((f) => fs.unlinkSync(path.join(UPLOADS_DIR, f)));
    res.json({ success: true, message: "Reset complete" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n Server running on http://localhost:${PORT}`);
  console.log(`   CV Engine: ${CV_ENGINE_URL}`);
  console.log(`   Client:    ${CLIENT_URL}\n`);
});