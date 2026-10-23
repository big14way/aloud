#!/usr/bin/env bash
# Entry point of the Nebius Serverless AI Job. The bucket is mounted at /workspace/data
# and holds distill/ (code + data); results go to /workspace/data/out.
set -euo pipefail

DATA="${DATA:-/workspace/data}"
# Object-storage mounts may not support symlinks, so each run writes to a named folder.
OUT="$DATA/out/${RUN_ID:-latest}"
BASE="${BASE_MODEL:-nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16}"
mkdir -p "$OUT"
cd "$DATA/distill"

python -c "import torch, transformers, peft; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'transformers', transformers.__version__, 'peft', peft.__version__, 'gpu', torch.cuda.get_device_name(0))" | tee "$OUT/versions.txt"

python train.py --data "$DATA/distill" --out "$OUT" --base "$BASE" --merge ${TRAIN_ARGS:-} 2>&1 | tee "$OUT/train.log"

if [ -f "$OUT/merged/config.json" ]; then
  python eval_student.py --model "$OUT/merged" --base "$BASE" --data "$DATA/distill/val.jsonl" --out "$OUT/eval_distil.json" --compare-base 2>&1 | tee "$OUT/eval.log"
else
  # Merge failed: evaluate base + adapter, and serve with vLLM --enable-lora.
  python eval_student.py --model "$BASE" --adapter "$OUT/adapter" --base "$BASE" --data "$DATA/distill/val.jsonl" --out "$OUT/eval_distil.json" --compare-base 2>&1 | tee "$OUT/eval.log"
fi

echo "Done: $OUT"
