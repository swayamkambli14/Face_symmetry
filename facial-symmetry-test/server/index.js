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

app.use(cors({ origin: CLIENT_URL }));
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files allowed"));
  },
});

// ── CV Engine HTTP Client ──────────────────────────────────────────────────────
async function callCVEngine(imagePath, mode, fingerprintPath = null) {
  const formData = new FormData();
  formData.append("mode", mode);
  formData.append("image", fs.createReadStream(imagePath));

  if (fingerprintPath && fs.existsSync(fingerprintPath)) {
    formData.append("fingerprint", fs.createReadStream(fingerprintPath));
  }

  const response = await fetch(`${CV_ENGINE_URL}/analyze`, {
    method: "POST",
    body: formData,
    headers: formData.getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CV Engine error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/baseline — upload normal photo, extract fingerprint
app.post("/api/baseline", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  const imagePath = req.file.path;
  const fingerprintPath = path.join(UPLOADS_DIR, "fingerprint.json");

  try {
    const result = await callCVEngine(imagePath, "baseline");

    if (result.error) {
      return res.status(422).json({ error: result.error });
    }

    // Save fingerprint locally
    fs.writeFileSync(fingerprintPath, JSON.stringify(result, null, 2));

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

// POST /api/analyze — capture test photo, compare vs baseline
app.post("/api/analyze", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  const fingerprintPath = path.join(UPLOADS_DIR, "fingerprint.json");

  if (!fs.existsSync(fingerprintPath)) {
    return res.status(400).json({ error: "No baseline found. Upload baseline photo first." });
  }

  const testImagePath = req.file.path;

  try {
    const result = await callCVEngine(testImagePath, "analyze", fingerprintPath);

    if (result.error) {
      return res.status(422).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status — check if baseline exists
app.get("/api/status", (req, res) => {
  const fingerprintPath = path.join(UPLOADS_DIR, "fingerprint.json");
  const hasBaseline = fs.existsSync(fingerprintPath);
  let baselineScores = null;
  if (hasBaseline) {
    try {
      const fp = JSON.parse(fs.readFileSync(fingerprintPath, "utf8"));
      const raw = fp.scores || {};
      baselineScores = Object.fromEntries(
        Object.entries(raw).filter(([k, v]) => typeof v === "number")
      );
    } catch (e) { }
  }
  res.json({ hasBaseline, baselineScores });
});

// DELETE /api/reset — clear all uploads for fresh test
app.delete("/api/reset", (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    files.forEach((f) => fs.unlinkSync(path.join(UPLOADS_DIR, f)));
    res.json({ success: true, message: "Reset complete" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Facial Symmetry API running on http://localhost:${PORT}`);
  console.log(`   CV Engine URL: ${CV_ENGINE_URL}`);
  console.log(`   Client URL: ${CLIENT_URL}`);
  console.log(`   Uploads: ${UPLOADS_DIR}\n`);
});