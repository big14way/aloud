# Evaluation

```bash
npm run eval                                   # memory scenarios + routing (rules; Lightning too if NEBIUS_API_KEY is set) + vision on the bundled samples
npm run eval -- --split heldout --write-docs   # report the held-out split once and write docs/eval.md
npm run eval -- --set eval/data/labels.json    # your own labelled photos
```

Flags: `--set <file>`, `--split dev|heldout|all`, `--no-vision`, `--no-model-routing`, `--no-judge`, `--write-docs`. Raw results go to `eval/runs/` (gitignored).

## Rules we follow

- Photos are split about 60/40 into **dev** and **heldout**. Thresholds, prompts and rules change only in response to dev results. The held-out split is reported once.
- Every rate is printed with its numerator and denominator. Any rate from fewer than 30 examples is marked **small set**.
- The bundled samples are rendered scenes. They prove the pipeline end to end; they are not a reliability claim.
- A blind or low-vision tester is worth more than any metric here. Feedback from real testers is included only with their consent, and never staged.

## What is measured

| Metric | How |
|---|---|
| OCR character error rate | Read's transcription (lines Aloud would speak, confidence ≥ 0.5) against `truth_text` |
| Words not on the page | Spoken words missing from `truth_text`, a proxy for invented text |
| Key-fact recall | `key_facts` found in what Aloud said (alternatives with `\|`) |
| Unsupported sentences | Describe and What-is sentences that Nemotron 3 Ultra judges inconsistent with `scene` |
| Correct abstention | Bad shots (`"expect": "guidance"`) where Aloud spoke only camera guidance |
| Forbidden-claim violations | Traffic-safety judgements, dosing advice, or identifying people in what was spoken (target 0) |
| Numbers not on the page | Any number spoken that is not in the label (target 0) |
| Two-frame numbers | Number lines agreed by both frames, adjudicated by Ultra, or abstained |
| Latency, cost | Server-side p50/p95 and $ per request from Token Factory usage |
| Memory | Scripted place / pick up / move / check sequences, run on the reducer with no model |
| Routing | 82 labelled spoken requests, per lane: rules, Lightning, and the distilled fast lane when it is up |

## Building the real photo set

Put photos in `eval/data/` (gitignored, never committed) and write `eval/data/labels.json`:

```json
{
  "name": "Kitchen and hallway, October 2026",
  "dir": "eval/data",
  "photos": [
    {
      "id": "letter-01",
      "file": "letter-01a.jpg",
      "file2": "letter-01b.jpg",
      "category": "text",
      "skill": "read",
      "truth_text": "Exact text in reading order",
      "key_facts": ["due 14 November"],
      "scene": "A letter on a table.",
      "numbers": ["14 November"],
      "split": "dev"
    }
  ]
}
```

- Aim for 60 photos (at least 40): printed text, grocery labels, appliance panels, rooms, price tags or banknotes, deliberately bad shots (dark, blurry, cut off), a road crossing, and scenes with a person present (no identification allowed).
- For Read and Label, take two frames about 400 ms apart (`file` and `file2`).
- No faces, and no third-party logos. If a person appears, get consent and blur their face.
- Categories: `text`, `grocery`, `appliance`, `scene`, `banknote`, `price`, `bad_shot`, `safety`, `people`, `object`. Set `"expect": "guidance"` for bad shots and `"hazard": true` when a hazard should be mentioned first.
