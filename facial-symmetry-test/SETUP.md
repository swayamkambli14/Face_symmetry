# Facial Symmetry Analyzer - Setup & Run Guide

## Installation Complete ✓

All dependencies have been installed successfully.

## Running the Application

You need to run 3 components in separate terminals:

### 1. Start the Backend Server
```bash
cd server
npm start
```
Server will run on: http://localhost:5000

### 2. Start the Frontend Client
```bash
cd client
npm run dev
```
Client will run on: http://localhost:3000

### 3. Python CV Engine
The Python engine runs automatically when the server calls it. No separate process needed.

## How to Use

1. Open http://localhost:3000 in your browser
2. Upload a baseline (normal) photo - clear, front-facing, evenly lit
3. Click "Open Camera" to capture a test photo
4. Align your face within the oval guide
5. Wait for all indicators to turn green (face detected, oval aligned, pose valid, lighting OK)
6. Click "Capture & Analyze" to compare against baseline
7. View the symmetry analysis results

## Dependencies Installed

### Client (React + Vite)
- react ^18.2.0
- react-dom ^18.2.0
- vite ^5.0.8
- @vitejs/plugin-react ^4.2.1

### Server (Node.js + Express)
- express ^4.18.2
- multer ^1.4.5-lts.1
- cors ^2.8.5

### CV Engine (Python)
- mediapipe 0.10.9
- opencv-python 4.9.0.80
- numpy 1.26.4
- scipy 1.12.0
- Pillow 10.2.0

## Troubleshooting

- If camera doesn't work, ensure you're using HTTPS or localhost
- If Python errors occur, verify Python 3 is installed and accessible as `python3`
- On Windows, you may need to use `python` instead of `python3` in server/index.js
