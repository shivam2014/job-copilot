---
name: youtube-transcript-extractor
description: Fetch and save YouTube video transcripts using the youtube_transcript_api Python library.
---
# YouTube Transcript Extractor

Fetch transcripts/captions from YouTube videos using `youtube_transcript_api`.

## Prerequisites
```
pip install youtube_transcript_api
```

## Usage

### Fetch a transcript (plain text)
```
python3 /Users/shivam94/.codex/skills/youtube-transcript-extractor/scripts/fetch_transcript.py VIDEO_ID --output data/
```

### Fetch with timestamps
```
python3 /Users/shivam94/.codex/skills/youtube-transcript-extractor/scripts/fetch_transcript.py VIDEO_ID --output data/ --format timestamps
```

### Fetch as JSON
```
python3 /Users/shivam94/.codex/skills/youtube-transcript-extractor/scripts/fetch_transcript.py VIDEO_ID --output data/ --format json
```

### List available transcripts
```
python3 /Users/shivam94/.codex/skills/youtube-transcript-extractor/scripts/fetch_transcript.py VIDEO_ID --list
```

## Output Formats

| Format | File | Content |
|---|---|---|
| `txt` | `data/VIDEO_ID.txt` | Plain concatenated text |
| `timestamps` | `data/VIDEO_ID_timestamps.txt` | `[start - end] text` per line |
| `json` | `data/VIDEO_ID.json` | JSON array of `{text, start, duration}` |

## Video ID Extraction

| URL | Video ID |
|---|---|
| `https://www.youtube.com/watch?v=DGUgpyniLsk` | `DGUgpyniLsk` |
| `https://youtu.be/VJo5vIxWawM` | `VJo5vIxWawM` |

## Error Handling
- If the API times out, retry after a few seconds
- Auto-generated captions are fetched but may contain errors
- Use `--list` first to check available languages
