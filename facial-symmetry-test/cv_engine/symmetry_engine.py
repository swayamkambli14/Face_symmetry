"""
Symmetry Engine — computes per-zone symmetry scores (0-100) from landmarks.

Core math:
  For each bilateral pair (left_idx, right_idx):
    1. Get pixel coords of both landmarks
    2. Compute the facial midline (nose bridge to chin)
    3. Measure distance of left landmark from midline
    4. Measure distance of right landmark from midline
    5. Symmetry ratio = min(d_left, d_right) / max(d_left, d_right)
       → 1.0 = perfect symmetry, 0.0 = completely asymmetric

  Zone score = mean of all pair ratios * 100
  Aggregate = weighted mean of all zone scores
"""

import numpy as np
from zone_calculator import ZONE_PAIRS, ZONE_WEIGHTS


def get_midline(landmarks, img_w, img_h):
    """
    Compute facial midline as a vertical line at the mean X
    of key midline landmarks: nose bridge(6), nose tip(4),
    philtrum(164), chin(152), forehead center(10).
    Returns midline_x in pixel coords.
    """
    midline_indices = [6, 4, 164, 152, 10, 1, 2, 200]
    xs = [landmarks[i]["x"] * img_w for i in midline_indices]
    return float(np.mean(xs))


def landmark_to_px(lm, img_w, img_h):
    return np.array([lm["x"] * img_w, lm["y"] * img_h])


def compute_pair_symmetry(lm_left, lm_right, midline_x, img_w, img_h):
    """
    Compute symmetry score for one bilateral pair.
    Returns float 0.0 - 1.0
    """
    left_px = landmark_to_px(lm_left, img_w, img_h)
    right_px = landmark_to_px(lm_right, img_w, img_h)

    d_left = abs(left_px[0] - midline_x)
    d_right = abs(right_px[0] - midline_x)

    # Also compare Y positions (vertical alignment)
    y_diff = abs(left_px[1] - right_px[1])
    face_height = img_h * 0.7  # approximate face height as 70% of image
    y_penalty = min(y_diff / face_height, 0.5)  # max 50% penalty from Y

    if max(d_left, d_right) == 0:
        dist_score = 1.0
    else:
        dist_score = min(d_left, d_right) / max(d_left, d_right)

    # Combine distance score and Y alignment
    combined = dist_score * (1.0 - y_penalty)
    return float(np.clip(combined, 0.0, 1.0))


def compute_zone_scores(landmarks, img_w, img_h):
    """
    Compute symmetry score for each zone.
    Returns dict: zone_name -> score (0-100)
    """
    midline_x = get_midline(landmarks, img_w, img_h)
    zone_scores = {}

    for zone, pairs in ZONE_PAIRS.items():
        pair_scores = []
        for left_idx, right_idx in pairs:
            # Skip self-pairs (midline landmarks like nose tip)
            if left_idx == right_idx:
                continue
            if left_idx >= len(landmarks) or right_idx >= len(landmarks):
                continue
            score = compute_pair_symmetry(
                landmarks[left_idx],
                landmarks[right_idx],
                midline_x,
                img_w,
                img_h,
            )
            pair_scores.append(score)

        if pair_scores:
            zone_scores[zone] = round(float(np.mean(pair_scores)) * 100, 2)
        else:
            zone_scores[zone] = 0.0

    return zone_scores


def compute_aggregate(zone_scores):
    """
    Weighted aggregate of all zone scores.
    Returns float 0-100.
    """
    total = 0.0
    weight_sum = 0.0
    for zone, score in zone_scores.items():
        w = ZONE_WEIGHTS.get(zone, 0.2)
        total += score * w
        weight_sum += w
    if weight_sum == 0:
        return 0.0
    return round(total / weight_sum, 2)


def compute_all_scores(landmarks, img_w, img_h):
    """
    Full pipeline: landmarks -> zone scores + aggregate.
    Returns dict ready for fingerprint storage or comparison.
    """
    zone_scores = compute_zone_scores(landmarks, img_w, img_h)
    aggregate = compute_aggregate(zone_scores)
    return {
        "zones": zone_scores,
        "aggregate": aggregate,
    }