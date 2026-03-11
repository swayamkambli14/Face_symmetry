"""
Main orchestrator — entry point called by Node server.

Usage:
  python analyze.py --mode baseline --image path/to/image.jpg --out path/to/fingerprint.json
  python analyze.py --mode analyze  --image path/to/test.jpg  --fingerprint path/to/fingerprint.json

Prints single JSON object to stdout. Node reads this.
"""

import sys
import json
import argparse

from landmark_extractor import extract_landmarks
from symmetry_engine import compute_all_scores
from comparator import compare


def run_baseline(image_path, out_path):
    extraction = extract_landmarks(image_path)

    if extraction["error"]:
        print(json.dumps({"error": extraction["error"]}))
        return

    scores = compute_all_scores(
        extraction["landmarks"],
        extraction["img_w"],
        extraction["img_h"],
    )

    fingerprint = {
        "scores": scores,
        "meta": {
            "image_path": image_path,
            "lighting_ratio": extraction["lighting_ratio"],
            "lighting_ok": extraction["lighting_ok"],
            "pose_valid": extraction["pose_valid"],
            "yaw_ratio": extraction["yaw_ratio"],
            "confidence": extraction["confidence"],
        },
    }

    with open(out_path, "w") as f:
        json.dump(fingerprint, f, indent=2)

    print(json.dumps({
        "success": True,
        "mode": "baseline",
        "scores": scores,
        "meta": fingerprint["meta"],
        "fingerprint_path": out_path,
    }))


def run_analyze(test_image_path, fingerprint_path):
    # Load baseline fingerprint
    try:
        with open(fingerprint_path, "r") as f:
            fingerprint = json.load(f)
    except FileNotFoundError:
        print(json.dumps({"error": f"Fingerprint not found: {fingerprint_path}. Upload baseline first."}))
        return

    baseline_scores = fingerprint["scores"]

    # Extract landmarks from test image
    extraction = extract_landmarks(test_image_path)

    if extraction["error"]:
        print(json.dumps({"error": extraction["error"]}))
        return

    live_scores = compute_all_scores(
        extraction["landmarks"],
        extraction["img_w"],
        extraction["img_h"],
    )

    result = compare(baseline_scores, live_scores)

    result["test_meta"] = {
        "lighting_ratio": extraction["lighting_ratio"],
        "lighting_ok": extraction["lighting_ok"],
        "pose_valid": extraction["pose_valid"],
        "yaw_ratio": extraction["yaw_ratio"],
        "confidence": extraction["confidence"],
    }

    result["baseline_meta"] = fingerprint["meta"]

    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["baseline", "analyze"], required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--out", default=None)
    parser.add_argument("--fingerprint", default=None)
    args = parser.parse_args()

    if args.mode == "baseline":
        out = args.out or args.image.replace(".jpg", "_fingerprint.json").replace(".png", "_fingerprint.json")
        run_baseline(args.image, out)
    elif args.mode == "analyze":
        if not args.fingerprint:
            print(json.dumps({"error": "--fingerprint path required for analyze mode"}))
            sys.exit(1)
        run_analyze(args.image, args.fingerprint)