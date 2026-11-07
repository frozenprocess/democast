# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "vibevoice @ git+https://github.com/microsoft/VibeVoice@1541f590c7099820f10ea012f48d2399282df69f",
#   "transformers==4.51.3",
#   "torch>=2.6,<2.8",  # newer torch.load refuses the voice preset files
# ]
# ///
"""democast TTS engine: Microsoft VibeVoice-Realtime-0.5B.

Usage: uv run --script vibevoice_engine.py jobs.json

jobs.json: {"voice": "Carter", "device": "cuda", "dtype": "float16", "cfg": 1.5, "steps": 5,
            "items": [{"text": "...", "out": "/path/clip.wav"}, ...]}

"voice" is one of the preset voices in the VibeVoice repo's
demo/voices/streaming_model directory, matched by name: Carter, Davis,
Emma, Frank, Grace, Mike, Samuel, or a full name like "de-Spk1_woman".
Presets are downloaded once to $XDG_CACHE_HOME/democast/vibevoice. The model
weights (about 2 GB) are fetched by Hugging Face into its own cache.

The device defaults to cuda when available, else cpu. On GPUs, "dtype"
defaults to bfloat16 where supported, else float16; on CPU, float32.
"""

import os
os.environ.setdefault("TQDM_DISABLE", "1")  # generate() shows a progress bar per clip

import copy
import json
import sys
import urllib.request
from pathlib import Path

import torch
from transformers.cache_utils import DynamicCache
from transformers.modeling_outputs import BaseModelOutputWithPast
from transformers.utils import logging as hf_logging
from vibevoice.modular.modeling_vibevoice_streaming_inference import (
    VibeVoiceStreamingForConditionalGenerationInference,
)
from vibevoice.processor.vibevoice_streaming_processor import VibeVoiceStreamingProcessor

COMMIT = "1541f590c7099820f10ea012f48d2399282df69f"
VOICES_API = f"https://api.github.com/repos/microsoft/VibeVoice/contents/demo/voices/streaming_model?ref={COMMIT}"
RAW = f"https://raw.githubusercontent.com/microsoft/VibeVoice/{COMMIT}/demo/voices/streaming_model/"
MODEL = "microsoft/VibeVoice-Realtime-0.5B"


def voice_path(name: str, cache: Path) -> Path:
    """voice_path finds the preset matching name, downloading it if needed."""
    index = cache / "index.json"
    if not index.exists():
        with urllib.request.urlopen(VOICES_API) as r:
            names = [e["name"] for e in json.load(r) if e["name"].endswith(".pt")]
        index.write_text(json.dumps(names))
    names = json.loads(index.read_text())
    want = name.lower()
    exact = [n for n in names if n[:-3].lower() == want]
    partial = [n for n in names if want in n.lower()]
    matches = exact or partial
    if len(matches) != 1:
        stems = ", ".join(n[:-3] for n in names)
        sys.exit(f"vibevoice: voice {name!r} matches {len(matches)} presets; available: {stems}")
    path = cache / matches[0]
    if not path.exists():
        print(f"democast: downloading voice {matches[0]}", file=sys.stderr)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(RAW + matches[0], tmp)
        tmp.rename(path)
    return path


def cast(obj, dtype):
    """cast converts the floating-point tensors in a voice preset (nested
    dicts, model outputs and KV caches) to the model's dtype."""
    if torch.is_tensor(obj):
        return obj.to(dtype) if obj.is_floating_point() else obj
    if isinstance(obj, DynamicCache):
        obj.key_cache = [cast(t, dtype) for t in obj.key_cache]
        obj.value_cache = [cast(t, dtype) for t in obj.value_cache]
        return obj
    if isinstance(obj, dict):  # includes transformers ModelOutput
        for k in list(obj.keys()):
            obj[k] = cast(obj[k], dtype)
        return obj
    if isinstance(obj, (list, tuple)):
        return type(obj)(cast(x, dtype) for x in obj)
    return obj


def main() -> None:
    hf_logging.set_verbosity_error()
    jobs = json.loads(Path(sys.argv[1]).read_text())
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "democast" / "vibevoice"
    cache.mkdir(parents=True, exist_ok=True)
    preset = voice_path(jobs.get("voice") or "Carter", cache)

    device = jobs.get("device") or ("cuda" if torch.cuda.is_available() else "cpu")
    dtypes = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}
    if jobs.get("dtype"):
        dtype = dtypes[jobs["dtype"]]
    elif device != "cuda":
        dtype = torch.float32
    elif torch.cuda.is_bf16_supported(including_emulation=False):
        dtype = torch.bfloat16
    else:
        # Older GPUs (e.g. Turing) lack bfloat16; float16 keeps the model
        # within small GPUs' memory.
        dtype = torch.float16
    print(f"vibevoice: {device}, {dtype}, voice {preset.stem}", file=sys.stderr)

    processor = VibeVoiceStreamingProcessor.from_pretrained(MODEL)
    model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
        MODEL, torch_dtype=dtype, device_map=device, attn_implementation="sdpa"
    )
    model.eval()
    model.set_ddpm_inference_steps(num_steps=int(jobs.get("steps", 5)))

    with torch.serialization.safe_globals([BaseModelOutputWithPast, DynamicCache]):
        prompt = torch.load(preset, map_location=device, weights_only=True)
    prompt = cast(prompt, dtype)

    for item in jobs["items"]:
        text = item["text"].replace("’", "'").replace("“", '"').replace("”", '"')
        inputs = processor.process_input_with_cached_prompt(
            text=text, cached_prompt=prompt, padding=True, return_tensors="pt", return_attention_mask=True
        )
        for k, v in inputs.items():
            if torch.is_tensor(v):
                inputs[k] = v.to(device)
        out = model.generate(
            **inputs,
            max_new_tokens=None,
            cfg_scale=float(jobs.get("cfg", 1.5)),
            tokenizer=processor.tokenizer,
            generation_config={"do_sample": False},
            verbose=False,
            all_prefilled_outputs=copy.deepcopy(prompt),
        )
        if not out.speech_outputs or out.speech_outputs[0] is None:
            sys.exit(f"vibevoice: no audio generated for {text!r}")
        processor.save_audio(out.speech_outputs[0], output_path=item["out"])
        print(f"vibevoice: {item['out']}", file=sys.stderr)


if __name__ == "__main__":
    main()
