from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
import subprocess
import tempfile
import os
import json
import shutil

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/analyze")
async def analyze(
    mode: str = Form(...),
    image: UploadFile = File(...),
    fingerprint: UploadFile = File(None)
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
        
        if mode == "analyze" and fingerprint:
            fingerprint_path = os.path.join(temp_dir, "fingerprint.json")
            with open(fingerprint_path, "wb") as f:
                shutil.copyfileobj(fingerprint.file, f)
            args.extend(["--fingerprint", fingerprint_path])
        
        # Run analyze.py
        result = subprocess.run(
            args,
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Analysis failed: {result.stderr}"
            )
        
        # Parse JSON output
        try:
            output = json.loads(result.stdout.strip())
            return JSONResponse(content=output)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=500,
                detail=f"Invalid JSON output: {result.stdout}"
            )
    
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Analysis timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temp files
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
