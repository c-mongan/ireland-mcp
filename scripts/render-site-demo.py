#!/usr/bin/env python3
"""Render labelled, edited browser captures. This does not drive a browser."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont


def run(command, cwd=None):
    subprocess.run(command, cwd=cwd, check=True)


def stamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    whole, fraction = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{whole:02}.{fraction:03}"


def wrapped(text, font, width):
    lines = []
    for paragraph in text.split("\n"):
        line = ""
        for word in paragraph.split():
            candidate = f"{line} {word}".strip()
            if font.getlength(candidate) > width and line:
                lines.append(line)
                line = word
            else:
                line = candidate
        lines.append(line)
    return lines


def compose(step, capture, font_path, provenance, burned_captions):
    frame = Image.new("RGB", (1280, 720), "#08130d")
    draw = ImageDraw.Draw(frame)
    title_font = ImageFont.truetype(str(font_path), 28)
    caption_font = ImageFont.truetype(str(font_path), 22)
    provenance_font = ImageFont.truetype(str(font_path), 16)
    if title_font.getlength(step["label"]) > 1220:
        raise ValueError("The title is too long for the frame.")
    if capture:
        with Image.open(capture) as original:
            image = original.convert("RGB")
        if step.get("crop"):
            x, y, width, height = step["crop"]
            if any(not isinstance(value, int) or value < 0 for value in (x, y, width, height)) or not width or not height:
                raise ValueError("A crop needs four valid integer pixel bounds.")
            if x + width > image.width or y + height > image.height:
                raise ValueError("The crop exceeds the actual capture bounds.")
            image = image.crop((x, y, x + width, y + height))
        ratio = min(1280 / image.width, 510 / image.height)
        image = image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)
        frame.paste(image, ((1280 - image.width) // 2, 86 + (510 - image.height) // 2))
    else:
        body = step.get("body", "Try it live\nirishopendata.ie/#playground")
        body_font = ImageFont.truetype(str(font_path), 32 if step.get("body") else 42)
        lines = wrapped(body, body_font, 1200)
        line_height = 50 if step.get("body") else 64
        y = 160 if step.get("body") else 280
        if y + len(lines) * line_height > 596:
            raise ValueError("The editorial card has too much text.")
        for line in lines:
            draw.text((40, y), line, font=body_font, fill="#eff6f0")
            y += line_height
    caption_lines = wrapped(step["caption"], caption_font, 1220)
    if len(caption_lines) > 2:
        raise ValueError("The caption needs more than two lines; shorten it.")
    if provenance_font.getlength(provenance) > 1220:
        raise ValueError("The provenance line is too long for the frame.")
    draw.text((30, 20), step["label"], font=title_font, fill="#e9f4ec")
    if burned_captions:
        for index, line in enumerate(caption_lines):
            draw.text((30, 614 + index * 28), line, font=caption_font, fill="#e0ede3")
    # Keep the native caption area clear when the player supplies the captions.
    draw.text((30, 690 if burned_captions else 62), provenance, font=provenance_font, fill="#adc7b4")
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--captions", type=Path, required=True)
    parser.add_argument("--poster", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--font", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--max-bytes", type=int, default=5000000)
    args = parser.parse_args()
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text())
    steps = manifest["steps"]
    burned_captions = manifest.get("burned_captions", True)
    if not isinstance(burned_captions, bool):
        raise ValueError("burned_captions must be a JSON boolean.")
    if not steps:
        raise ValueError("The manifest needs at least one verified capture.")
    total = sum(float(step["seconds"]) for step in steps)
    if abs(total - float(manifest["duration"])) > 0.001:
        raise ValueError("Step durations must equal the declared duration.")
    if any(float(step["seconds"]) <= 0 for step in steps):
        raise ValueError("Step durations must be positive.")
    if not any(step.get("capture") for step in steps):
        raise ValueError("At least one actual browser capture is required.")
    source_paths = []
    for step in steps:
        if step.get("capture"):
            path = Path(step["capture"])
            path = path if path.is_absolute() else manifest_path.parent / path
            path = path.resolve(strict=True)
            source_paths.append(path)
        else:
            source_paths.append(None)
    scratch = args.scratch.resolve()
    if scratch.exists() and any(scratch.iterdir()):
        raise ValueError("Use a new, empty scratch directory to preserve prior work.")
    scratch.mkdir(parents=True, exist_ok=True)
    output = args.output.resolve()
    captions = args.captions.resolve()
    poster = args.poster.resolve()
    for path in (output, captions, poster):
        if path.exists():
            raise ValueError(f"Output already exists; choose a new path: {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
    candidates = [args.font] if args.font else [
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    font = next((path for path in candidates if path and path.is_file()), None)
    if font is None:
        raise ValueError("Provide an installed font with --font; no font is downloaded.")
    vtt = ["WEBVTT", "", "NOTE Edited still captures; timing is editorial, not measured latency.", ""]
    elapsed = 0.0
    receipts = []
    for index, (step, capture) in enumerate(zip(steps, source_paths)):
        segment = f"segment-{index:02}.mp4"
        image_path = scratch / f"frame-{index:02}.png"
        compose(step, capture, font, manifest["provenance"], burned_captions).save(image_path)
        run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "24", "-i", str(image_path),
             "-t", str(step["seconds"]), "-an", "-r", "24",
             "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-threads", "2",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", segment], cwd=scratch)
        end = elapsed + float(step["seconds"])
        vtt.extend([str(index + 1), f"{stamp(elapsed)} --> {stamp(end)}", step["caption"], ""])
        receipts.append({"capture": str(capture) if capture else None,
                         "sha256": hashlib.sha256(capture.read_bytes()).hexdigest() if capture else None,
                         "crop": step.get("crop"), "editorial_text": step.get("body") if not capture else None,
                         "start": elapsed, "end": end, "caption": step["caption"]})
        elapsed = end
    (scratch / "concat.txt").write_text("".join(f"file 'segment-{i:02}.mp4'\n" for i in range(len(steps))))
    run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "1",
         "-i", "concat.txt", "-c", "copy", "-movflags", "+faststart", str(output)], cwd=scratch)
    metadata = json.loads(subprocess.check_output([
        args.ffprobe, "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_name,width,height,r_frame_rate,pix_fmt,nb_frames",
        "-of", "json", str(output)]))
    video = metadata["streams"][0]
    if video.get("codec_name") != "h264" or video.get("pix_fmt") != "yuv420p":
        raise ValueError("The encoded video contract did not match H.264 YUV 4:2:0.")
    if (video.get("width"), video.get("height")) != (1280, 720):
        raise ValueError("The encoded video must be 1280 by 720.")
    if abs(float(metadata["format"]["duration"]) - total) > 0.05:
        raise ValueError("The encoded duration did not match the edit.")
    if output.stat().st_size > args.max_bytes:
        raise ValueError("The encoded file exceeded the size budget. Preserve it and revise the edit.")
    run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(output), "-f", "null", "-"])
    run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", str(manifest.get("poster_at", total / 2)),
         "-i", str(output), "-frames:v", "1", str(poster)])
    run([args.ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(output),
         "-vf", f"fps=1/{total/6},scale=427:240,tile=3x2", "-frames:v", "1", "contact.jpg"], cwd=scratch)
    captions.write_text("\n".join(vtt))
    (scratch / "receipt.json").write_text(json.dumps({
        "edited_still_captures": True, "burned_captions": burned_captions, "captured_at": manifest["captured_at"],
        "provenance": manifest["provenance"], "segments": receipts, "metadata": metadata,
        "output_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "full_decode": "passed"}, indent=2) + "\n")
    print(json.dumps({"output": str(output), "seconds": total, "bytes": output.stat().st_size,
                      "captions": str(captions), "poster": str(poster), "receipt": str(scratch / "receipt.json")}))


if __name__ == "__main__":
    main()
