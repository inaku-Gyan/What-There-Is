"""Extract per-layer particle sets from `References/` and bake one combined JSON.

Each layer (background / table / Santa) was pre-segmented at the same
resolution by the user, so all three share a common coordinate space.
The output JSON groups particles by name and is consumed by
`the-page/src/particles.js`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


# Declaration order is rendering order: background draws first, then table,
# then Santa on top. Counts are tuned for the source image's relative areas
# — background fills the frame, table is a chunky shape, Santa is small.
GROUPS: list[tuple[str, str, int]] = [
    ("background", "background.png", 100_000),
    ("table",      "table.png",       35_000),
    ("santa",      "Santa.png",       25_000),
]


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


def encode_group(name: str, particles: np.ndarray) -> dict:
    return {
        "name": name,
        "particles": [
            [round(float(x), 4), round(float(y), 4), round(float(b), 3)]
            for x, y, b in particles
        ],
    }


def write_json(width: int, height: int, groups: list[dict], output: Path) -> int:
    payload = {
        "width": width,
        "height": height,
        "groups": groups,
    }
    text = json.dumps(payload, separators=(",", ":"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text)
    return len(text)


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_DIR = SCRIPT_DIR / "References"
DEFAULT_OUTPUT    = SCRIPT_DIR.parent / "the-page" / "particles.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_DIR,
                        help="Directory containing the per-layer PNGs listed in GROUPS.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
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

    encoded_groups: list[dict] = []
    canvas_size: tuple[int, int] | None = None

    for offset, (name, filename, count) in enumerate(GROUPS):
        path = args.input / filename
        brightness = load_grayscale(path)
        h, w = brightness.shape
        if canvas_size is None:
            canvas_size = (w, h)
        elif canvas_size != (w, h):
            raise ValueError(
                f"{filename}: size {(w, h)} differs from first layer {canvas_size}; "
                "all layers must share the same dimensions."
            )

        # Distinct seed per group so layers don't sample identical pixel indices
        # in their (rare) overlaps; keeps the result reproducible.
        try:
            particles = sample_particles(
                brightness, count, args.gamma, args.threshold, args.seed + offset
            )
        except ValueError as e:
            raise ValueError(f"{filename}: {e}") from e

        encoded_groups.append(encode_group(name, particles))
        print(f"loaded {w}x{h}, sampled {count} particles from {name} ({filename})")

    assert canvas_size is not None
    width, height = canvas_size
    size_bytes = write_json(width, height, encoded_groups, args.output)
    size_kb = size_bytes / 1024
    total = sum(len(g["particles"]) for g in encoded_groups)
    print(f"wrote {args.output} — {len(encoded_groups)} groups, {total} particles, {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
