const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();
const PORT =  process.env.PORT || 5000 ;

app.use(cors());
app.use(express.json());

// ── Storage ──────────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
const CV_ENGINE_DIR = path.join(__dirname, "..", "cv_engine");

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

// ── Python Spawner ────────────────────────────────────────────────────────────
function runPython(args) {
  return new Promise((resolve, reject) => {
    const PYTHON_BIN = process.env.PYTHON_BIN || "python";
    const py = spawn(PYTHON_BIN, [path.join(CV_ENGINE_DIR, "analyze.py"), ...args], {
      cwd: CV_ENGINE_DIR,
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("close", (code) => {
      if (!stdout.trim()) {
        return reject(new Error(`Python error (code ${code}): ${stderr}`));
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        reject(new Error(`JSON parse failed. stdout: ${stdout} stderr: ${stderr}`));
      }
    });
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/baseline — upload normal photo, extract fingerprint
app.post("/api/baseline", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  const imagePath = req.file.path;
  const fingerprintPath = path.join(UPLOADS_DIR, "fingerprint.json");

  try {
    const result = await runPython([
      "--mode", "baseline",
      "--image", imagePath,
      "--out", fingerprintPath,
    ]);

    if (result.error) {
      return res.status(422).json({ error: result.error });
    }

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
    const result = await runPython([
      "--mode", "analyze",
      "--image", testImagePath,
      "--fingerprint", fingerprintPath,
    ]);

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
      // scores is flat: {forehead: 88.4, eyes: 82.1, ...}
      // filter out any non-number values before sending
      const raw = fp.scores || {};
      baselineScores = Object.fromEntries(
        Object.entries(raw).filter(([k, v]) => typeof v === "number")
      );
    } catch (e) {}
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
  console.log(`   CV Engine: ${CV_ENGINE_DIR}`);
  console.log(`   Uploads:   ${UPLOADS_DIR}\n`);
});