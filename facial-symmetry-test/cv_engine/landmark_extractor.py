import cv2
import numpy as np
import mediapipe as mp

mp_face_mesh = mp.solutions.face_mesh


def apply_clahe(image_bgr):
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_eq = clahe.apply(l)
    lab_eq = cv2.merge([l_eq, a, b])
    return cv2.cvtColor(lab_eq, cv2.COLOR_LAB2BGR)


def check_lighting(image_bgr, landmarks, img_w, img_h):
    xs = [lm.x * img_w for lm in landmarks]
    ys = [lm.y * img_h for lm in landmarks]
    x_min = max(0, int(min(xs)))
    x_max = min(img_w, int(max(xs)))
    y_min = max(0, int(min(ys)))
    y_max = min(img_h, int(max(ys)))
    face_region = image_bgr[y_min:y_max, x_min:x_max]
    if face_region.size == 0:
        return 1.0, True
    gray_face = cv2.cvtColor(face_region, cv2.COLOR_BGR2GRAY)
    mid = gray_face.shape[1] // 2
    left_brightness = float(np.mean(gray_face[:, :mid]))
    right_brightness = float(np.mean(gray_face[:, mid:]))
    if right_brightness == 0:
        return 1.0, True
    ratio = left_brightness / right_brightness
    acceptable = 0.75 <= ratio <= 1.25
    return round(ratio, 3), acceptable


def validate_pose(landmarks, img_w, img_h):
    nose = landmarks[1]
    left_ear = landmarks[234]
    right_ear = landmarks[454]
    nose_x = nose.x * img_w
    left_ear_x = left_ear.x * img_w
    right_ear_x = right_ear.x * img_w
    left_dist = abs(nose_x - left_ear_x)
    right_dist = abs(right_ear_x - nose_x)
    if right_dist == 0:
        return False, 0
    yaw_ratio = left_dist / right_dist
    is_valid = 0.75 <= yaw_ratio <= 1.33
    return is_valid, round(yaw_ratio, 3)


def extract_landmarks(image_path, apply_lighting_norm=True):
    image_bgr = cv2.imread(image_path)
    if image_bgr is None:
        return {"error": f"Cannot load image: {image_path}"}

    img_h, img_w = image_bgr.shape[:2]

    if apply_lighting_norm:
        image_bgr_norm = apply_clahe(image_bgr)
    else:
        image_bgr_norm = image_bgr

    image_rgb = cv2.cvtColor(image_bgr_norm, cv2.COLOR_BGR2RGB)

    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    ) as face_mesh:
        results = face_mesh.process(image_rgb)

    if not results.multi_face_landmarks:
        return {"error": "No face detected in image"}

    face_landmarks = results.multi_face_landmarks[0].landmark

    visibilities = [lm.visibility if hasattr(lm, "visibility") else 1.0 for lm in face_landmarks]
    confidence = float(np.mean(visibilities))

    raw_bgr = cv2.imread(image_path)
    lighting_ratio, lighting_ok = check_lighting(raw_bgr, face_landmarks, img_w, img_h)
    pose_valid, yaw_ratio = validate_pose(face_landmarks, img_w, img_h)

    landmarks = [{"x": lm.x, "y": lm.y, "z": lm.z} for lm in face_landmarks]

    return {
        "landmarks": landmarks,
        "img_w": img_w,
        "img_h": img_h,
        "lighting_ratio": lighting_ratio,
        "lighting_ok": lighting_ok,
        "pose_valid": pose_valid,
        "yaw_ratio": yaw_ratio,
        "confidence": round(confidence, 3),
        "error": None,
    }