from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse
import subprocess
import tempfile
import os
import json
import shutil
import traceback

app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(
    mode: str = Form(...),
    image: UploadFile = File(...),
    fingerprint_data: str = Form(None),  # base64 JSON string of fingerprint
):
    temp_dir = tempfile.mkdtemp()

    try:
        # Save uploaded image
        image_path = os.path.join(temp_dir, "image.jpg")
        with open(image_path, "wb") as f:
            shutil.copyfileobj(image.file, f)

        # Build command args
        args = ["python", "analyze.py", "--mode", mode, "--image", image_path]

        if mode == "baseline":
            out_path = os.path.join(temp_dir, "fingerprint.json")
            args.extend(["--out", out_path])

        if mode == "analyze":
            if not fingerprint_data:
                return JSONResponse(
                    status_code=400,
                    content={"error": "No fingerprint data provided. Upload baseline first."}
                )
            fingerprint_path = os.path.join(temp_dir, "fingerprint.json")
            with open(fingerprint_path, "w") as f:
                f.write(fingerprint_data)
            args.extend(["--fingerprint", fingerprint_path])

        # Run analyze.py
        result = subprocess.run(
            args,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True,
            timeout=60
        )

        # Return stderr so we can debug
        if result.returncode != 0:
            return JSONResponse(
                status_code=500,
                content={"error": result.stderr or "Unknown error", "stdout": result.stdout}
            )

        if not result.stdout.strip():
            return JSONResponse(
                status_code=500,
                content={"error": "No output from analyze.py", "stderr": result.stderr}
            )

        try:
            output = json.loads(result.stdout.strip())
        except json.JSONDecodeError:
            return JSONResponse(
                status_code=500,
                content={"error": "Invalid JSON from analyze.py", "raw": result.stdout, "stderr": result.stderr}
            )

        # For baseline mode, attach fingerprint JSON so client can store it
        if mode == "baseline":
            out_path = os.path.join(temp_dir, "fingerprint.json")
            if os.path.exists(out_path):
                with open(out_path, "r") as f:
                    output["fingerprint_data"] = f.read()

        return JSONResponse(content=output)

    except subprocess.TimeoutExpired:
        return JSONResponse(status_code=504, content={"error": "Analysis timed out after 60s"})
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "trace": traceback.format_exc()}
        )
    finally:
        try:
            shutil.rmtree(temp_dir)
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)