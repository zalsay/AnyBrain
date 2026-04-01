import argparse
import subprocess
from collections import deque
from pathlib import Path
from typing import Optional, Protocol, cast

from PIL import Image


class PixelMap(Protocol):
    def __getitem__(self, xy: tuple[int, int]) -> tuple[int, int, int, int]: ...
    def __setitem__(self, xy: tuple[int, int], value: tuple[int, int, int, int]) -> None: ...


class Args(argparse.Namespace):
    light: bool = False
    file: str = "logo.png"
    output: Optional[str] = None
    black_threshold: int = 24


def is_near_black(pixel: tuple[int, int, int, int], threshold: int) -> bool:
    r, g, b, _ = pixel
    return r <= threshold and g <= threshold and b <= threshold


def replace_edge_connected_black_background(
    img: Image.Image,
    background_color: tuple[int, int, int, int],
    threshold: int = 24,
) -> Image.Image:
    """Replace edge-connected near-black pixels with a solid background color."""
    working = img.convert("RGBA")
    width, height = working.size
    raw_pixels = working.load()

    if raw_pixels is None:
        raise RuntimeError("Unable to access image pixels")

    pixels = cast(PixelMap, raw_pixels)

    visited = [[False for _ in range(width)] for _ in range(height)]
    queue: deque[tuple[int, int]] = deque()

    def enqueue_if_background(x: int, y: int) -> None:
        if visited[y][x]:
            return
        pixel = pixels[x, y]
        if is_near_black(pixel, threshold):
            visited[y][x] = True
            queue.append((x, y))

    for x in range(width):
        enqueue_if_background(x, 0)
        enqueue_if_background(x, height - 1)
    for y in range(height):
        enqueue_if_background(0, y)
        enqueue_if_background(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = background_color

        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not visited[ny][nx]:
                pixel = pixels[nx, ny]
                if is_near_black(pixel, threshold):
                    visited[ny][nx] = True
                    queue.append((nx, ny))

    return working


def process_logo(
    input_path: str,
    output_path: str,
    light_background: bool = False,
    generate_tauri_icons: bool = True,
    black_threshold: int = 24,
) -> None:
    try:
        with Image.open(input_path) as img:
            img = img.convert("RGBA")

            if light_background:
                result = Image.new("RGBA", img.size, (255, 255, 255, 255))
                result.alpha_composite(img)
                result = replace_edge_connected_black_background(
                    result,
                    background_color=(255, 255, 255, 255),
                    threshold=black_threshold,
                )
            else:
                result = img.copy()

            result.save(output_path, "PNG")
            print(f"Successfully saved processed logo to {output_path}")

            if generate_tauri_icons:
                print(f"Generating Tauri icons from {output_path}...")
                try:
                    _ = subprocess.run(
                        ["npm", "run", "tauri", "icon", "--", output_path],
                        check=True,
                    )
                    print("Successfully generated all Tauri icons.")
                except subprocess.CalledProcessError as e:
                    print(f"Error generating Tauri icons: {e}")
                except FileNotFoundError:
                    print("Error: 'npm' command not found. Please ensure Node.js is installed.")

    except Exception as e:
        print(f"Error processing image: {e}")
        raise SystemExit(1) from e


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Process a logo image and optionally generate Tauri icons.",
    )
    _ = parser.add_argument(
        "--light",
        action="store_true",
        help="Generate a white background version. Also replaces edge-connected black background.",
    )
    _ = parser.add_argument("--file", default="logo.png", help="Input image path.")
    _ = parser.add_argument(
        "--output",
        help="Output image path. If provided, skips Tauri icon generation.",
    )
    _ = parser.add_argument(
        "--black-threshold",
        type=int,
        default=24,
        help="Threshold for treating edge-connected dark pixels as background in --light mode.",
    )
    args = parser.parse_args(namespace=Args())

    input_file = args.file
    output_file = args.output if args.output else "app-icon.png"
    generate_tauri_icons = args.output is None

    Path(output_file).parent.mkdir(parents=True, exist_ok=True)

    process_logo(
        input_file,
        output_file,
        light_background=args.light,
        generate_tauri_icons=generate_tauri_icons,
        black_threshold=args.black_threshold,
    )
