import { useState, useRef, useEffect, useCallback } from "react";

const API = "http://localhost:5000/api";
const OVAL = { cx: 0.5, cy: 0.48, rx: 0.22, ry: 0.35 };

function inOval(x, y) {
    return ((x - OVAL.cx) / OVAL.rx) ** 2 + ((y - OVAL.cy) / OVAL.ry) ** 2 <= 1;
}

const COND0 = { face: false, oval: false, pose: false, light: false };

// ─── CameraView is OUTSIDE App so its DOM never remounts on state change ────
function CameraView({ videoRef, overlayRef, cond, mpInit, allGreen, processing, onCapture, onClose, captureLabel }) {
    const S = camStyles();
    return (
        <div>
            {/* condition dots */}
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
                {[["face", "Face detected"], ["oval", "Oval aligned"], ["pose", "Pose valid"], ["light", "Lighting OK"]]
                    .map(([k, lbl]) => (
                        <span key={k} style={{ fontSize: 11 }}>
                            <span style={dot(cond[k])} />{lbl}
                        </span>
                    ))}
                {!mpInit && <span style={{ fontSize: 11, color: "#666" }}>⟳ detector loading...</span>}
            </div>

            {/* video + oval overlay stacked */}
            <div style={{ position: "relative", display: "inline-block", lineHeight: 0, maxWidth: "100%" }}>
                <video
                    ref={videoRef}
                    autoPlay muted playsInline
                    style={{ display: "block", borderRadius: 6, width: 640, maxWidth: "100%", background: "#111", transform: "scaleX(-1)" }}
                />
                <canvas
                    ref={overlayRef}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", borderRadius: 6 }}
                />
            </div>

            <div style={{ marginTop: 10 }}>
                <button style={S.btn("#00ff88", !allGreen || processing)} onClick={onCapture} disabled={!allGreen || processing}>
                    {processing ? "⟳ Processing..." : allGreen ? captureLabel : "Waiting for conditions..."}
                </button>
                <button style={S.btn("#1a1a1a")} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

function dot(ok) {
    return { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ok ? "#00ff88" : "#2a2a2a", marginRight: 7, verticalAlign: "middle" };
}

function camStyles() {
    return {
        btn: (bg = "#00ff88", dis = false) => ({
            background: dis ? "#161616" : bg,
            color: dis ? "#333" : bg === "#00ff88" ? "#000" : "#bbb",
            border: "none", borderRadius: 6, padding: "9px 20px",
            cursor: dis ? "not-allowed" : "pointer",
            fontFamily: "monospace", fontWeight: "bold", fontSize: 12,
            marginRight: 8, marginTop: 8,
        }),
    };
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
    const [step, setStep] = useState("baseline");
    const [camOpen, setCamOpen] = useState(false);
    const [cond, setCond] = useState(COND0);
    const [mpReady, setMpReady] = useState(false);
    const [mpInit, setMpInit] = useState(false);
    const [baselineImg, setBaselineImg] = useState(null);
    const [baselineScores, setBaselineScores] = useState(null);
    const [testImg, setTestImg] = useState(null);
    const [result, setResult] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [err, setErr] = useState(null);

    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const streamRef = useRef(null);
    const fmRef = useRef(null);
    const rafRef = useRef(null);      // rAF for overlay drawing
    const fmTimerRef = useRef(null);      // setInterval for FaceMesh (separate from rAF)
    const aliveRef = useRef(false);
    const condRef = useRef(COND0);
    const labelRef = useRef("");

    const allGreen = Object.values(cond).every(Boolean);

    useEffect(() => { condRef.current = cond; }, [cond]);

    // ── Load MediaPipe ────────────────────────────────────────────────────
    useEffect(() => {
        if (window.FaceMesh) { setMpReady(true); return; }
        const sc = Object.assign(document.createElement("script"), {
            src: "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js",
            crossOrigin: "anonymous",
            onload: () => setMpReady(true),
            onerror: () => setErr("Failed to load MediaPipe — check connection"),
        });
        document.head.appendChild(sc);
        return () => { try { document.head.removeChild(sc); } catch (_) { } };
    }, []);

    // ── Draw oval overlay only (video renders itself) ─────────────────────
    const drawOverlay = useCallback(() => {
        const canvas = overlayRef.current;
        const video = videoRef.current;
        if (!canvas || !video || !video.videoWidth) return;

        const W = video.videoWidth, H = video.videoHeight;
        if (canvas.width !== W) canvas.width = W;
        if (canvas.height !== H) canvas.height = H;

        const ctx = canvas.getContext("2d");
        const ready = Object.values(condRef.current).every(Boolean);
        ctx.clearRect(0, 0, W, H);

        const cx = OVAL.cx * W, cy = OVAL.cy * H;
        const rx = OVAL.rx * W, ry = OVAL.ry * H;

        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = ready ? "#00ff88" : "rgba(255,255,255,0.8)";
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffaa00";
        ctx.font = "bold 13px monospace";
        ctx.fillText(labelRef.current, cx, cy - ry - 12);

        ctx.fillStyle = ready ? "#00ff88" : "rgba(255,255,255,0.85)";
        ctx.font = "13px monospace";
        ctx.fillText(ready ? "✓ READY — click Capture" : "Align face inside the oval", cx, cy + ry + 24);
    }, []);

    // ── Evaluate conditions from landmarks ────────────────────────────────
    const evalCond = useCallback((lms) => {
        if (!lms || lms.length < 468) { setCond(COND0); return; }

        const face = true;
        const hits = [10, 152, 234, 454, 70, 300].filter(i => lms[i] && inOval(lms[i].x, lms[i].y));
        const oval = hits.length >= 5;

        const nose = lms[1], lE = lms[234], rE = lms[454];
        const yr = Math.abs(rE.x - nose.x) > 0 ? Math.abs(nose.x - lE.x) / Math.abs(rE.x - nose.x) : 1;
        const pose = yr >= 0.75 && yr <= 1.33;

        // lighting via temporary canvas (does NOT touch overlay)
        let light = true;
        try {
            const vid = videoRef.current;
            if (vid && vid.videoWidth) {
                const W = vid.videoWidth, H = vid.videoHeight;
                const tmp = document.createElement("canvas");
                tmp.width = W; tmp.height = H;
                tmp.getContext("2d").drawImage(vid, 0, 0, W, H);
                const tc = tmp.getContext("2d");
                const xs = lms.map(l => l.x * W), ys = lms.map(l => l.y * H);
                const x0 = Math.max(0, Math.min(...xs));
                const fw = Math.min(W, Math.max(...xs)) - x0;
                const y0 = Math.max(0, Math.min(...ys));
                const fh = Math.min(H, Math.max(...ys)) - y0;
                if (fw > 30 && fh > 30) {
                    const avg = d => { let s = 0, n = 0; for (let i = 0; i < d.length; i += 4) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; } return n ? s / n : 128; };
                    const r = avg(tc.getImageData(x0, y0, fw / 2, fh).data) / avg(tc.getImageData(x0 + fw / 2, y0, fw / 2, fh).data);
                    light = r >= 0.7 && r <= 1.3;
                }
            }
        } catch (_) { light = true; }

        setCond({ face, oval, pose, light });
    }, []);

    // ── Open camera ───────────────────────────────────────────────────────
    const openCamera = useCallback(async (label) => {
        if (!mpReady) { setErr("MediaPipe still loading — wait a moment"); return; }
        setErr(null);
        labelRef.current = label;
        aliveRef.current = true;
        setCamOpen(true);
        setCond(COND0);
        setMpInit(false);

        await new Promise(r => setTimeout(r, 150)); // let React mount video element

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: "user" },
            });
            streamRef.current = stream;

            const vid = videoRef.current;
            if (!vid) throw new Error("Video element not mounted");
            vid.srcObject = stream;
            await vid.play();

            // wait for first real frame
            await new Promise(res => {
                const check = () => (vid.readyState >= 3 && vid.videoWidth > 0) ? res() : setTimeout(check, 40);
                check();
            });

            // init FaceMesh (no .initialize() — lazy)
            const fm = new window.FaceMesh({
                locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
            });
            fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
            fm.onResults(res => {
                if (!aliveRef.current) return;
                setMpInit(true);
                evalCond(res.multiFaceLandmarks?.[0] ?? null);
            });
            fmRef.current = fm;

            // rAF loop — ONLY draws overlay, never touches FaceMesh
            const paintLoop = () => {
                if (!aliveRef.current) return;
                drawOverlay();
                rafRef.current = requestAnimationFrame(paintLoop);
            };
            rafRef.current = requestAnimationFrame(paintLoop);

            // FaceMesh runs on a SEPARATE interval (every 200ms = 5fps)
            // Completely decoupled from the paint loop
            fmTimerRef.current = setInterval(async () => {
                if (!aliveRef.current || !fmRef.current) return;
                const vid2 = videoRef.current;
                if (!vid2 || vid2.readyState < 2 || !vid2.videoWidth) return;
                try { await fmRef.current.send({ image: vid2 }); } catch (_) { }
            }, 200);

        } catch (e) {
            aliveRef.current = false;
            setCamOpen(false);
            setErr(`Camera error: ${e.message}`);
        }
    }, [mpReady, drawOverlay, evalCond]);

    // ── Close camera ──────────────────────────────────────────────────────
    const closeCamera = useCallback(() => {
        aliveRef.current = false;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (fmTimerRef.current) clearInterval(fmTimerRef.current);
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (videoRef.current) videoRef.current.srcObject = null;
        fmRef.current = null;
        setCamOpen(false);
        setCond(COND0);
        setMpInit(false);
    }, []);

    useEffect(() => () => closeCamera(), [closeCamera]);

    // ── Capture clean photo ───────────────────────────────────────────────
    const capturePhoto = useCallback(() => {
        const vid = videoRef.current;
        if (!vid || !vid.videoWidth) return null;
        const c = document.createElement("canvas");
        c.width = vid.videoWidth; c.height = vid.videoHeight;
        c.getContext("2d").drawImage(vid, 0, 0);
        return c;
    }, []);

    // ── Handle capture button ─────────────────────────────────────────────
    const handleCapture = useCallback(async () => {
        if (!allGreen || processing) return;
        const snap = capturePhoto();
        if (!snap) { setErr("Failed to capture — try again"); return; }
        const dataUrl = snap.toDataURL("image/jpeg", 0.92);
        closeCamera();

        if (step === "baseline") {
            setBaselineImg(dataUrl);
            setProcessing(true); setErr(null);
            snap.toBlob(async blob => {
                const fd = new FormData(); fd.append("image", blob, "baseline.jpg");
                try {
                    const r = await fetch(`${API}/baseline`, { method: "POST", body: fd });
                    const d = await r.json();
                    if (d.error) throw new Error(d.error);
                    setBaselineScores(d.scores); setStep("test");
                } catch (e) { setErr(e.message); setBaselineImg(null); }
                finally { setProcessing(false); }
            }, "image/jpeg", 0.95);
        } else {
            setTestImg(dataUrl);
            setProcessing(true); setErr(null);
            snap.toBlob(async blob => {
                const fd = new FormData(); fd.append("image", blob, "test.jpg");
                try {
                    const r = await fetch(`${API}/analyze`, { method: "POST", body: fd });
                    const d = await r.json();
                    if (d.error) throw new Error(d.error);
                    setResult(d); setStep("result");
                } catch (e) { setErr(e.message); setTestImg(null); }
                finally { setProcessing(false); }
            }, "image/jpeg", 0.95);
        }
    }, [allGreen, processing, step, capturePhoto, closeCamera]);

    // ── Reset ─────────────────────────────────────────────────────────────
    const reset = useCallback(async () => {
        closeCamera();
        try { await fetch(`${API}/reset`, { method: "DELETE" }); } catch (_) { }
        setStep("baseline"); setBaselineImg(null); setBaselineScores(null);
        setTestImg(null); setResult(null); setErr(null); setCond(COND0);
    }, [closeCamera]);

    // ── Styles ────────────────────────────────────────────────────────────
    const S = {
        app: { fontFamily: "monospace", background: "#0a0a0a", color: "#e0e0e0", minHeight: "100vh", padding: 24, maxWidth: 860, margin: "0 auto" },
        h1: { color: "#00ff88", fontSize: 20, marginBottom: 2, letterSpacing: 2 },
        sub: { color: "#444", fontSize: 11, marginBottom: 22 },
        card: { background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: 22, marginBottom: 14 },
        lbl: { color: "#555", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 10 },
        err: { background: "#1a0000", border: "1px solid #500", color: "#ff6666", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12 },
        btn: (bg = "#00ff88", dis = false) => ({
            background: dis ? "#161616" : bg, color: dis ? "#333" : bg === "#00ff88" ? "#000" : "#bbb",
            border: "none", borderRadius: 6, padding: "9px 20px", cursor: dis ? "not-allowed" : "pointer",
            fontFamily: "monospace", fontWeight: "bold", fontSize: 12, marginRight: 8, marginTop: 8,
        }),
        verdict: v => ({ fontSize: 28, fontWeight: "bold", letterSpacing: 3, color: v === "NORMAL" ? "#00ff88" : v === "WARNING" ? "#ffaa00" : "#ff4444" }),
        zRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #181818", flexWrap: "wrap", gap: 4 },
        badge: st => ({
            padding: "2px 9px", borderRadius: 4, fontSize: 11, fontWeight: "bold",
            background: st === "NORMAL" ? "#003322" : st === "WARNING" ? "#332200" : "#330011",
            color: st === "NORMAL" ? "#00ff88" : st === "WARNING" ? "#ffaa00" : "#ff4444"
        }),
        stepBar: { display: "flex", marginBottom: 22 },
        stepItm: (a, d) => ({
            flex: 1, padding: "7px 0", textAlign: "center", fontSize: 10,
            background: d ? "#002218" : a ? "#001208" : "#0a0a0a",
            color: d ? "#00ff88" : a ? "#00bb55" : "#2a2a2a",
            borderBottom: `2px solid ${d ? "#00ff88" : a ? "#00bb55" : "#1a1a1a"}`
        }),
        thumb: { width: 150, height: 110, objectFit: "cover", borderRadius: 6, border: "1px solid #1e1e1e" },
    };

    return (
        <div style={S.app}>
            <div style={S.h1}>FACIAL SYMMETRY ANALYZER</div>
            <div style={S.sub}>test build — feature validation</div>

            <div style={S.stepBar}>
                {[["1. Baseline", step === "baseline", step === "test" || step === "result"],
                ["2. Test Photo", step === "test", step === "result"],
                ["3. Result", step === "result", false]]
                    .map(([lbl, active, done]) => (
                        <div key={lbl} style={S.stepItm(active, done)}>{done ? "✓ " : ""}{lbl}</div>
                    ))}
            </div>

            {err && <div style={S.err}>⚠ {err}</div>}

            {/* ── BASELINE ── */}
            {step === "baseline" && (
                <div style={S.card}>
                    <span style={S.lbl}>Step 1 — Capture baseline photo</span>
                    <p style={{ color: "#444", fontSize: 12, marginBottom: 16, lineHeight: 1.7 }}>
                        Normal reference. Even lighting, look straight, face inside oval. All 4 dots green → click capture.
                    </p>
                    {!camOpen
                        ? <button style={S.btn()} onClick={() => openCamera("BASELINE PHOTO")} disabled={processing}>
                            {mpReady ? "📷 Open Camera" : "⟳ Loading..."}
                        </button>
                        : <CameraView
                            videoRef={videoRef} overlayRef={overlayRef}
                            cond={cond} mpInit={mpInit} allGreen={allGreen} processing={processing}
                            onCapture={handleCapture} onClose={closeCamera}
                            captureLabel="📸 Capture Baseline"
                        />
                    }
                    {processing && <div style={{ color: "#00ff88", fontSize: 12, marginTop: 10 }}>⟳ Saving baseline...</div>}
                </div>
            )}

            {/* ── TEST ── */}
            {step === "test" && (
                <>
                    {baselineImg && (
                        <div style={{ ...S.card, display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                            <div>
                                <div style={S.lbl}>Baseline ✓</div>
                                <img src={baselineImg} alt="baseline" style={S.thumb} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={S.lbl}>Zone Scores</div>
                                {baselineScores && Object.entries(baselineScores)
                                    .filter(([k]) => k !== "midline_x")
                                    .map(([zone, score]) => (
                                        <div key={zone} style={{ fontSize: 11, marginBottom: 3 }}>
                                            <span style={{ color: "#333", display: "inline-block", width: 76 }}>{zone}</span>
                                            <span style={{ color: "#00ff88" }}>{typeof score === "number" ? score.toFixed(1) : String(score)}</span>
                                        </div>
                                    ))}
                            </div>
                            <button style={{ ...S.btn("#1a1a1a"), alignSelf: "flex-start", marginTop: 20 }}
                                onClick={() => { setStep("baseline"); setBaselineImg(null); closeCamera(); }}>
                                ↩ Retake
                            </button>
                        </div>
                    )}
                    <div style={S.card}>
                        <span style={S.lbl}>Step 2 — Capture test photo</span>
                        <p style={{ color: "#444", fontSize: 12, marginBottom: 16, lineHeight: 1.7 }}>
                            Same conditions — even lighting, face straight, oval aligned.
                        </p>
                        {!camOpen
                            ? <button style={S.btn()} onClick={() => openCamera("TEST PHOTO")} disabled={processing}>
                                {mpReady ? "📷 Open Camera" : "⟳ Loading..."}
                            </button>
                            : <CameraView
                                videoRef={videoRef} overlayRef={overlayRef}
                                cond={cond} mpInit={mpInit} allGreen={allGreen} processing={processing}
                                onCapture={handleCapture} onClose={closeCamera}
                                captureLabel="📸 Capture & Analyze"
                            />
                        }
                        {processing && <div style={{ color: "#00ff88", fontSize: 12, marginTop: 10 }}>⟳ Analyzing...</div>}
                    </div>
                </>
            )}

            {/* ── RESULT ── */}
            {step === "result" && result && (
                <div style={S.card}>
                    <span style={S.lbl}>Result</span>
                    <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                        {baselineImg && <div style={{ textAlign: "center" }}>
                            <img src={baselineImg} alt="baseline" style={S.thumb} />
                            <div style={{ fontSize: 9, color: "#333", marginTop: 4 }}>BASELINE</div>
                        </div>}
                        {testImg && <div style={{ textAlign: "center" }}>
                            <img src={testImg} alt="test" style={S.thumb} />
                            <div style={{ fontSize: 9, color: "#333", marginTop: 4 }}>TEST</div>
                        </div>}
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <div style={S.verdict(result.verdict)}>{result.verdict}</div>
                        <div style={{ color: "#555", fontSize: 12, marginTop: 6 }}>{result.summary}</div>
                        {result.triggered_by?.length > 0 && (
                            <div style={{ color: "#ffaa00", fontSize: 11, marginTop: 5 }}>⚡ {result.triggered_by.join(", ")}</div>
                        )}
                    </div>

                    <div style={S.lbl}>Zone Breakdown</div>
                    {Object.entries(result.zones).map(([zone, d]) => (
                        <div key={zone} style={S.zRow}>
                            <span style={{ fontSize: 11, width: 68, textTransform: "uppercase", color: d.critical ? "#ffaa00" : "#555" }}>
                                {d.critical ? "⚠ " : ""}{zone}
                            </span>
                            <span style={{ fontSize: 11, color: "#333" }}>
                                base <span style={{ color: "#888" }}>{d.baseline}</span>{"  →  "}
                                live <span style={{ color: "#888" }}>{d.live}</span>
                            </span>
                            <span style={{ fontSize: 11, color: "#444" }}>Δ {d.deviation}%</span>
                            <span style={S.badge(d.status)}>{d.status}</span>
                        </div>
                    ))}
                    {result.aggregate && (
                        <div style={{ ...S.zRow, borderBottom: "none", marginTop: 6 }}>
                            <span style={{ fontSize: 11, width: 68, color: "#555" }}>AGGREGATE</span>
                            <span style={{ fontSize: 11, color: "#333" }}>
                                base <span style={{ color: "#888" }}>{result.aggregate.baseline}</span>{"  →  "}
                                live <span style={{ color: "#888" }}>{result.aggregate.live}</span>
                            </span>
                            <span style={{ fontSize: 11, color: "#444" }}>Δ {result.aggregate.deviation}%</span>
                            <span style={S.badge(result.aggregate.status)}>{result.aggregate.status}</span>
                        </div>
                    )}
                    {result.lighting && <div style={{ marginTop: 14, fontSize: 11, color: "#333" }}>💡 {result.lighting.message}</div>}

                    <details style={{ marginTop: 14 }}>
                        <summary style={{ cursor: "pointer", color: "#333", fontSize: 11 }}>raw JSON</summary>
                        <pre style={{ background: "#0a0a0a", padding: 12, borderRadius: 6, fontSize: 10, overflow: "auto", marginTop: 8, color: "#555" }}>
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    </details>

                    <div style={{ marginTop: 14 }}>
                        <button style={S.btn()} onClick={() => { setResult(null); setTestImg(null); setStep("test"); }}>Test Again</button>
                        <button style={S.btn("#1a1a1a")} onClick={reset}>Reset All</button>
                    </div>
                </div>
            )}
        </div>
    );
}