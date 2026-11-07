# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = ["kokoro-onnx==0.6.1", "soundfile==0.14.0"]
# ///
"""democast TTS engine: Kokoro-82M via ONNX Runtime, on CPU.

Usage: uv run --script kokoro_engine.py jobs.json

jobs.json: {"voice": "af_heart", "speed": 1.0, "lang": "en-us", "model": "fp32",
            "items": [{"text": "...", "out": "/path/clip.wav"}, ...]}

Model files (about 330 MB, or 90 MB for model "int8") are downloaded once to
$XDG_CACHE_HOME/democast/kokoro.
"""

import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODELS = {"fp32": "kokoro-v1.0.onnx", "int8": "kokoro-v1.0.int8.onnx"}
VOICES = "voices-v1.0.bin"
# SHA-256 of each file in the release. GitHub publishes none, so these were
# taken from two separate downloads that agreed (2026-11-06). A file that
# doesn't match is not loaded: the models are fetched over the network.
SHA256 = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name: str, cache: Path) -> Path:
    path = cache / name
    if not path.exists():
        print(f"democast: downloading {name} to {cache}", file=sys.stderr)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(BASE + name, tmp)
        if digest(tmp) != SHA256[name]:
            tmp.unlink()
            sys.exit(f"kokoro: {name} downloaded from {BASE} does not match its expected SHA-256; not using it")
        tmp.rename(path)
    elif digest(path) != SHA256[name]:
        sys.exit(f"kokoro: {path} does not match its expected SHA-256 (damaged or replaced?); delete it to download again")
    return path


def main() -> None:
    jobs = json.loads(Path(sys.argv[1]).read_text())
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "democast" / "kokoro"
    cache.mkdir(parents=True, exist_ok=True)
    model = MODELS.get(jobs.get("model", "fp32"))
    if model is None:
        sys.exit(f"kokoro: unknown model {jobs['model']!r}; want one of {', '.join(MODELS)}")
    kokoro = Kokoro(str(fetch(model, cache)), str(fetch(VOICES, cache)))

    voice = jobs.get("voice") or "af_heart"
    if voice not in kokoro.get_voices():
        sys.exit(f"kokoro: unknown voice {voice!r}; available: {', '.join(sorted(kokoro.get_voices()))}")
    for item in jobs["items"]:
        samples, rate = kokoro.create(
            item["text"], voice=voice, speed=float(jobs.get("speed", 1.0)), lang=jobs.get("lang", "en-us")
        )
        sf.write(item["out"], samples, rate)
        print(f"kokoro: {item['out']}", file=sys.stderr)


if __name__ == "__main__":
    main()
