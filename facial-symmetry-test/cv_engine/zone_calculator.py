"""
Maps MediaPipe 468 landmark indices into 5 facial zones.
Each zone has LEFT and RIGHT landmark index groups.
Bilateral pairs are used for symmetry comparison.
"""

# Each zone: list of (left_index, right_index) bilateral pairs
# Indices based on MediaPipe Face Mesh canonical map

ZONE_PAIRS = {
    "forehead": [
        (103, 332), (67, 297), (109, 338), (10, 10),
        (338, 109), (297, 67), (332, 103), (54, 284),
        (21, 251), (162, 389),
    ],
    "eyes": [
        # Left eye vs Right eye landmark pairs
        (33, 263),   (160, 387),  (158, 385),  (133, 362),
        (153, 380),  (144, 373),  (163, 390),  (7, 249),
        # Eyebrow pairs
        (46, 276),   (53, 283),   (52, 282),   (65, 295),
        (55, 285),   (107, 336),  (66, 296),   (105, 334),
        (63, 293),   (70, 300),
    ],
    "nose": [
        (48, 278),   (115, 344),  (131, 360),  (134, 363),
        (102, 331),  (49, 279),   (129, 358),  (98, 327),
        (97, 326),   (2, 2),
    ],
    "mouth": [
        (61, 291),   (39, 269),   (37, 267),   (0, 0),
        (17, 17),    (84, 314),   (91, 321),   (78, 308),
        (80, 310),   (81, 311),   (82, 312),   (87, 317),
        (88, 318),   (95, 325),   (146, 375),  (185, 409),
        (40, 270),   (38, 268),
    ],
    "jaw": [
        (172, 397),  (136, 365),  (150, 379),  (149, 378),
        (176, 400),  (148, 377),  (152, 152),  (377, 148),
        (400, 176),  (378, 149),  (379, 150),  (365, 136),
        (397, 172),  (288, 58),   (361, 132),  (323, 93),
    ],
}

# Clinical weight per zone (how much each zone matters diagnostically)
ZONE_WEIGHTS = {
    "forehead": 0.10,
    "eyes":     0.35,   # highest — key stroke/palsy indicator
    "nose":     0.15,
    "mouth":    0.25,   # second — drooping mouth corner
    "jaw":      0.15,
}


def get_zone_landmark_indices():
    """Return flat list of all landmark indices used, per zone."""
    result = {}
    for zone, pairs in ZONE_PAIRS.items():
        indices = set()
        for left, right in pairs:
            indices.add(left)
            indices.add(right)
        result[zone] = sorted(indices)
    return result


def get_bilateral_pairs():
    """Return zone pairs dict directly."""
    return ZONE_PAIRS


def get_zone_weights():
    return ZONE_WEIGHTS