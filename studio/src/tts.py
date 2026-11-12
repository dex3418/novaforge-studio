#!/usr/bin/env python3
"""Edge TTS helper: speaks the text AND records when each part is spoken.

Usage:  python3 tts.py <voice> <rate> <out.mp3> <out.json>     (text comes on stdin)

out.json = {"kind": "word" | "sentence" | "none", "marks": [{"text", "start", "end"}, ...]}
Times are in seconds from the start of the audio. Newer edge-tts versions send
sentence timings by default, so we ask for word timings first and fall back.
"""
import asyncio
import json
import sys

import edge_tts


def make(text, voice, rate):
    try:
        return edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    except TypeError:  # older edge-tts: no boundary option, words are the default
        return edge_tts.Communicate(text, voice, rate=rate)


async def run(text, voice, rate, mp3, out_json):
    comm = make(text, voice, rate)
    words, sents, got_audio = [], [], False
    with open(mp3, "wb") as f:
        async for ch in comm.stream():
            kind = ch.get("type")
            if kind == "audio":
                f.write(ch["data"])
                got_audio = True
            elif kind in ("WordBoundary", "SentenceBoundary"):
                start = ch["offset"] / 1e7  # 100-nanosecond ticks
                end = start + ch["duration"] / 1e7
                (words if kind == "WordBoundary" else sents).append(
                    {"text": ch["text"], "start": start, "end": end}
                )
    if not got_audio:
        raise RuntimeError("no audio received from the voice service")
    marks = words or sents
    kind = "word" if words else ("sentence" if sents else "none")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"kind": kind, "marks": marks}, f, ensure_ascii=False)


def main():
    if len(sys.argv) != 5:
        sys.exit("usage: tts.py <voice> <rate> <out.mp3> <out.json>")
    voice, rate, mp3, out_json = sys.argv[1:5]
    text = sys.stdin.read().strip()
    if not text:
        sys.exit("no text")
    asyncio.run(run(text, voice, rate, mp3, out_json))


if __name__ == "__main__":
    main()
