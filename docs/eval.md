# Aloud evaluation

Run 2026-10-23T19:57:50.801Z · split: **all** · models: vision `nvidia/Nemotron-3.5-Super-VL`, fast `nvidia/Nemotron-3_5-Lightning`, judge `nvidia/Nemotron-3-Ultra-550b-a55b`

## Memory answers (deterministic reducer)

Scripted sequences (place, pick up, move silently, check with the camera, ambiguous names). Each must produce the right answer status and keep its status words.

- Correct answer status and wording: 100.0% (12/12), small set

## Intent routing

82 labelled spoken requests (synthetic, all). Correct means the right skill and the key argument words.

The rules lane was tuned on the dev split, so its held-out row is the honest one.

| Lane | Split | Accuracy | Valid tool calls | p50 latency | $ per 1K calls |
|---|---|---|---|---|---|
| Rules (offline) | dev | 100.0% (49/49) | 100.0% (49/49) | 0.00 s | $0.000 |
| Rules (offline) | heldout | 78.8% (26/33) | 100.0% (33/33) | 0.00 s | $0.000 |

## Vision answers

Set: **Bundled synthetic samples** (13 photos in this split). These are rendered synthetic scenes, not real photos, so they show the pipeline works end to end; they are not a reliability claim.

Vision evaluation needs NEBIUS_API_KEY; not run.

