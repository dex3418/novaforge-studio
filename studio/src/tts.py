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


def make(text, voice, rate, pitch="+0Hz", volume="+0%"):
    kw = dict(rate=rate, pitch=pitch, volume=volume)
    try:
        return edge_tts.Communicate(text, voice, boundary="WordBoundary", **kw)
    except TypeError:  # older edge-tts: no boundary option, words are the default
        return edge_tts.Communicate(text, voice, **kw)


async def run(text, voice, rate, mp3, out_json, pitch="+0Hz", volume="+0%"):
    comm = make(text, voice, rate, pitch, volume)
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


async def batch(voice, prefix, chunks):
    """Speaks many short chunks (each with its own rate/pitch/volume) a few at a time."""
    sem = asyncio.Semaphore(4)

    async def one(i, c):
        async with sem:
            last = None
            for _ in range(3):
                try:
                    await run(c["text"], voice, c.get("rate", "+0%"), f"{prefix}.{i}.mp3", f"{prefix}.{i}.json",
                              c.get("pitch", "+0Hz"), c.get("volume", "+0%"))
                    return
                except Exception as e:  # network hiccup: try again
                    last = e
                    await asyncio.sleep(1.2)
            raise last

    await asyncio.gather(*[one(i, c) for i, c in enumerate(chunks)])


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "--batch":
        chunks = json.loads(sys.stdin.read())
        asyncio.run(batch(sys.argv[2], sys.argv[3], chunks))
        return
    if len(sys.argv) != 5:
        sys.exit("usage: tts.py <voice> <rate> <out.mp3> <out.json>")
    voice, rate, mp3, out_json = sys.argv[1:5]
    text = sys.stdin.read().strip()
    if not text:
        sys.exit("no text")
    asyncio.run(run(text, voice, rate, mp3, out_json))


if __name__ == "__main__":
    main()
