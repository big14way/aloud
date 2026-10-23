"""LoRA SFT of Nemotron 3 Nano 4B on Aloud's teacher data. Runs as a Nebius Serverless AI Job.

Recipe: bf16 LoRA r=16, alpha=32, all linear layers (attention and Mamba projections),
completion-only loss, lr 2e-4 cosine, 2 epochs, batch 2, max length 2048.

Loss masking is done here rather than with TRL, so the script depends only on the
stable transformers Trainer and peft APIs. Prompts and completions are rendered with
the student's own chat template (thinking off), exactly as vLLM renders them at serve time.
"""

import argparse
import json
import os
import sys
import time

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_jsonl, load_model, render  # noqa: E402


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, help="Directory with train.jsonl and val.jsonl")
    p.add_argument("--out", required=True, help="Output directory (adapter/, merged/, train_summary.json)")
    p.add_argument("--base", default="nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16")
    p.add_argument("--epochs", type=float, default=2)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=2)
    p.add_argument("--max-len", type=int, default=2048)
    p.add_argument("--rank", type=int, default=16)
    p.add_argument("--alpha", type=int, default=32)
    p.add_argument("--merge", action="store_true", help="Also save a merged bf16 model for vLLM")
    p.add_argument("--mamba-chunk-size", type=int, default=0, help="Override config.chunk_size when the Mamba kernels are unavailable (e.g. 64)")
    p.add_argument("--gradient-checkpointing", action="store_true")
    return p.parse_args()


class Examples(torch.utils.data.Dataset):
    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return self.rows[i]


def tokenize(tokenizer, examples, max_len):
    rows, skipped, truncated = [], 0, 0
    for ex in examples:
        rendered = render(tokenizer, ex)
        if rendered is None:
            skipped += 1
            continue
        prompt, completion = rendered
        p_ids = tokenizer(prompt, add_special_tokens=False)["input_ids"]
        c_ids = tokenizer(completion, add_special_tokens=False)["input_ids"]
        if len(p_ids) + len(c_ids) > max_len:
            truncated += 1
            continue
        rows.append({"input_ids": p_ids + c_ids, "labels": [-100] * len(p_ids) + c_ids, "task": ex["task"]})
    return rows, skipped, truncated


def make_collator(pad_id):
    def collate(batch):
        width = max(len(b["input_ids"]) for b in batch)
        ids, labels, mask = [], [], []
        for b in batch:
            pad = width - len(b["input_ids"])
            ids.append(b["input_ids"] + [pad_id] * pad)
            labels.append(b["labels"] + [-100] * pad)
            mask.append([1] * len(b["input_ids"]) + [0] * pad)
        return {"input_ids": torch.tensor(ids), "labels": torch.tensor(labels), "attention_mask": torch.tensor(mask)}

    return collate


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)
    started = time.time()

    tokenizer = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    pad_id = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id

    train_rows, train_skipped, train_trunc = tokenize(tokenizer, load_jsonl(os.path.join(args.data, "train.jsonl")), args.max_len)
    val_rows, val_skipped, val_trunc = tokenize(tokenizer, load_jsonl(os.path.join(args.data, "val.jsonl")), args.max_len)
    print(f"train {len(train_rows)} (skipped {train_skipped}, too long {train_trunc}); val {len(val_rows)} (skipped {val_skipped}, too long {val_trunc})", flush=True)
    if not train_rows:
        sys.exit("No training examples survived rendering: check the chat template split.")
    print("Example completion:", repr(tokenizer.decode([t for t in train_rows[0]["labels"] if t != -100])), flush=True)

    model = load_model(AutoModelForCausalLM, args.base, trust_remote_code=True, device_map={"": 0})
    if args.mamba_chunk_size:
        model.config.chunk_size = args.mamba_chunk_size
    if args.gradient_checkpointing:
        model.gradient_checkpointing_enable()
        model.enable_input_require_grads()
    lora = LoraConfig(r=args.rank, lora_alpha=args.alpha, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM")
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    training = TrainingArguments(
        output_dir=os.path.join(args.out, "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        bf16=True,
        logging_steps=10,
        eval_strategy="epoch" if val_rows else "no",
        save_strategy="no",
        report_to=[],
        remove_unused_columns=False,
        gradient_checkpointing=False,
        dataloader_num_workers=0,
    )
    trainer = Trainer(
        model=model,
        args=training,
        train_dataset=Examples(train_rows),
        eval_dataset=Examples(val_rows) if val_rows else None,
        data_collator=make_collator(pad_id),
    )
    trainer.train()

    adapter_dir = os.path.join(args.out, "adapter")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    print(f"Saved adapter to {adapter_dir}", flush=True)

    merge_error = None
    if args.merge:
        try:
            merged = model.merge_and_unload()
            merged_dir = os.path.join(args.out, "merged")
            merged.save_pretrained(merged_dir, safe_serialization=True)
            tokenizer.save_pretrained(merged_dir)
            print(f"Saved merged model to {merged_dir}", flush=True)
        except Exception as err:  # Fallback ladder: serve the adapter with vLLM --enable-lora instead.
            merge_error = f"{type(err).__name__}: {err}"
            print(f"Merge failed, keeping the adapter only: {merge_error}", flush=True)

    summary = {
        "base": args.base,
        "hyperparameters": {"rank": args.rank, "alpha": args.alpha, "target_modules": "all-linear", "lr": args.lr, "scheduler": "cosine", "epochs": args.epochs, "batch": args.batch, "max_len": args.max_len},
        "examples": {"train": len(train_rows), "val": len(val_rows), "skipped": train_skipped + val_skipped, "too_long": train_trunc + val_trunc},
        "log_history": trainer.state.log_history,
        "merge_error": merge_error,
        "minutes": round((time.time() - started) / 60, 1),
    }
    with open(os.path.join(args.out, "train_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
