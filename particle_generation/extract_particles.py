"""Extract particles from a black-and-white reference image via brightness-weighted importance sampling."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def load_grayscale(path: Path) -> np.ndarray:
    img = Image.open(path).convert("L")
    return np.asarray(img, dtype=np.float32) / 255.0


def sample_particles(
    brightness: np.ndarray,
    count: int,
    gamma: float,
    threshold: float,
    seed: int,
) -> np.ndarray:
    """Return an (N, 3) array of [x, y, b] in normalized [0, 1] coords."""
    h, w = brightness.shape
    weights = brightness.copy()

    if threshold > 0.0:
        weights[weights < threshold] = 0.0
    if gamma != 1.0:
        weights = np.power(weights, gamma, dtype=np.float32)

    total = float(weights.sum())
    if total <= 0.0:
        raise ValueError("Image is entirely below threshold; nothing to sample.")

    probs = (weights / total).ravel()
    rng = np.random.default_rng(seed)
    indices = rng.choice(h * w, size=count, replace=True, p=probs)

    rows, cols = np.divmod(indices, w)
    jitter = rng.uniform(-0.5, 0.5, size=(count, 2)).astype(np.float32)

    x = (cols.astype(np.float32) + 0.5 + jitter[:, 0]) / w
    y = (rows.astype(np.float32) + 0.5 + jitter[:, 1]) / h
    # Use the original (un-gamma'd) brightness for visual fidelity in JS rendering.
    b = brightness[rows, cols]

    return np.stack([x, y, b], axis=1)


def write_json(particles: np.ndarray, width: int, height: int, output: Path) -> int:
    payload = {
        "width": width,
        "height": height,
        "count": int(particles.shape[0]),
        "particles": [
            [round(float(x), 4), round(float(y), 4), round(float(b), 3)]
            for x, y, b in particles
        ],
    }
    text = json.dumps(payload, separators=(",", ":"))
    output.write_text(text)
    return len(text)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("Reference.png"))
    parser.add_argument("--output", type=Path, default=Path("particles.json"))
    parser.add_argument("--count", type=int, default=160000, help="Number of particles to sample.")
    parser.add_argument(
        "--gamma",
        type=float,
        default=1.0,
        help=">1 emphasizes bright regions; <1 lifts faint detail.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.0,
        help="Drop pixels below this normalized brightness before sampling.",
    )
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    brightness = load_grayscale(args.input)
    h, w = brightness.shape
    particles = sample_particles(brightness, args.count, args.gamma, args.threshold, args.seed)
    size_bytes = write_json(particles, w, h, args.output)
    size_kb = size_bytes / 1024
    print(
        f"loaded {w}x{h}, sampled {args.count} particles, "
        f"wrote {args.output} ({size_kb:.1f} KB)"
    )


if __name__ == "__main__":
    main()
