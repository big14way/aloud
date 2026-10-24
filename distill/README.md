# Distilling Aloud's text work into Nemotron 3 Nano 4B

Perception stays on Nemotron 3.5 Super VL: a 4B text model can't see. But three text jobs run on almost every turn, and a small specialised model can do them faster, more cheaply, and offline:

1. **Intent routing**: a spoken request becomes one tool call with flat arguments.
2. **Speech shaping**: long answers are rewritten into easy language without losing hedges, numbers or quotes.
3. **Simple-mode plans**: a scene becomes up to five short steps.

Today Nemotron 3.5 Lightning does these on Token Factory. The distilled student is the optional **fast lane**. When `FASTLANE_URL` is set and `/v1/models` answers, the API uses it. Otherwise everything falls back to Lightning automatically, and `/api/health` reports the lane as `down` or `not_configured`.

## Pipeline

| Step | Where | What |
|---|---|---|
| Teacher data | Token Factory | `npx tsx distill/generate.ts`. Nemotron 3 Ultra paraphrases the **dev** routing seeds, routes them, rewrites long answers, and writes plans. Code keeps only outputs that pass the same checks the app enforces. Held-out evaluation utterances are never used as seeds. Paraphrases of one seed never straddle train and val. |
| Training | Serverless AI **Job** | `train.py`: bf16 LoRA (r=16, α=32, all linear layers including the Mamba projections), completion-only loss, lr 2e-4 cosine, 2 epochs, batch 2, max length 2048. Prompts and completions are rendered with the student's own chat template, thinking off, as vLLM renders them. |
| Evaluation | Same job | `eval_student.py` scores the student and the untouched base model on the val split: routing accuracy, valid tool calls, JSON validity, rule compliance and latency. Decoding is greedy with repetition penalty 1.15. Output: `out/latest/eval_distil.json`. |
| Serving | Serverless AI **Endpoint** | vLLM with `--enable-auto-tool-choice --tool-call-parser qwen3_coder`, token auth, stopped when not in use. |
| Comparison in the app | Local | `npm run eval` adds a "Distilled Nemotron Nano 4B" row to the routing table when the endpoint is up. |

## Teacher data (generated 24 October 2026)

Nemotron 3 Ultra on Token Factory, $2.80 in total. Code kept only teacher outputs that passed Aloud's own checks:

| Task | Kept / tried | Train | Val |
|---|---|---|---|
| Routing (tool calls) | 570 / 598 | 500 | 70 |
| Easy-language rewrites | 234 / 250 | 212 | 22 |
| Simple-mode plans | 145 / 150 | 131 | 14 |

None of the 33 held-out evaluation utterances appear in the data. The data stays out of git and goes to Object Storage with `nebius.sh upload`.

## Run it

```bash
npx tsx distill/generate.ts                  # ~1,000 examples, about $2-4 of Ultra on Token Factory
python -m unittest discover -s distill       # helper tests, no GPU needed
bash distill/nebius.sh upload                # bucket + code + data
bash distill/nebius.sh train                 # 1x L40S job; nebius ai job logs <id> --follow
export FASTLANE_TOKEN=$(openssl rand -hex 32)
bash distill/nebius.sh serve                 # prints the endpoint URL
# put FASTLANE_URL and FASTLANE_TOKEN in .env, then:
npm run eval -- --no-vision                  # Rules vs Lightning vs distilled 4B
bash distill/nebius.sh stop                  # endpoints bill per second while running
```

Results live in the bucket under `out/latest/`: `train_summary.json` (loss curve, example counts), `eval_distil.json`, and the `adapter/` and `merged/` weights. Weights never go into git.

## If the platform fights back

1. **Merge fails**: `train.py` keeps the adapter, and the job evaluates base plus adapter. Serve with vLLM `--enable-lora --lora-modules aloud=/models/out/latest/adapter` on the base model.
2. **vLLM won't load Nemotron-H on the endpoint's CUDA**: keep the in-job evaluation numbers. They come from transformers, so they don't need vLLM.
3. **No GPU quota**: run only the evaluation on Token Factory models (`npm run eval`) and say so plainly.
4. **Mamba kernels missing**: transformers falls back to the PyTorch path. Pass `TRAIN_ARGS="--mamba-chunk-size 64"` if memory is tight.
