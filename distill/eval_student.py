"""Held-out evaluation of the distilled student (and optionally the untouched base model).

Greedy decoding with repetition_penalty 1.15 (stops JSON loops in small models).
Writes eval_distil.json with routing accuracy, valid tool calls, JSON validity,
rule compliance and latency, each with its numerator and denominator.
"""

import argparse
import json
import os
import statistics
import sys
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (  # noqa: E402
    END_OF_TURN,
    TEMPLATE_KWARGS,
    first_json_object,
    load_jsonl,
    load_model,
    parse_tool_call,
    plan_problems,
    route_correct,
    shape_inputs,
    shape_problems,
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True, help="Merged model directory, or the base model id")
    p.add_argument("--adapter", default=None, help="LoRA adapter directory, when no merged model exists")
    p.add_argument("--base", default="nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16")
    p.add_argument("--data", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-new-tokens", type=int, default=320)
    p.add_argument("--compare-base", action="store_true", help="Also score the base model without fine-tuning")
    return p.parse_args()


def rate(num, den):
    return {"num": num, "den": den, "pct": round(100 * num / den, 1) if den else None}


def evaluate(model, tokenizer, examples, max_new_tokens):
    per_task = {"route": [], "shape": [], "plan": []}
    latencies, samples = [], []
    for ex in examples:
        prompt = tokenizer.apply_chat_template(ex["messages"], tools=ex.get("tools"), tokenize=False, add_generation_prompt=True, **TEMPLATE_KWARGS)
        ids = tokenizer(prompt, add_special_tokens=False, return_tensors="pt").to(model.device)
        started = time.time()
        with torch.no_grad():
            out = model.generate(**ids, max_new_tokens=max_new_tokens, do_sample=False, repetition_penalty=1.15, pad_token_id=tokenizer.eos_token_id)
        latencies.append(time.time() - started)
        text = tokenizer.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=False).split(END_OF_TURN)[0]
        task = ex["task"]
        if task == "route":
            pred = parse_tool_call(text)
            result = {"valid": pred is not None, "correct": route_correct(pred, ex["target"]["tool_call"])}
        else:
            obj = first_json_object(text)
            if task == "shape":
                ok = isinstance(obj, dict) and isinstance(obj.get("sentences"), list)
                problems = shape_problems(shape_inputs(ex), [str(s) for s in obj["sentences"]]) if ok else ["invalid JSON"]
            else:
                ok = isinstance(obj, dict)
                problems = plan_problems(obj) if ok else ["invalid JSON"]
            result = {"valid": ok, "correct": ok and not problems}
        per_task[task].append(result)
        if len(samples) < 15:
            samples.append({"task": task, "output": text[:400], **result})
    summary = {}
    for task, rs in per_task.items():
        if rs:
            summary[task] = {"valid": rate(sum(r["valid"] for r in rs), len(rs)), "correct": rate(sum(r["correct"] for r in rs), len(rs))}
    summary["latency_p50_s"] = round(statistics.median(latencies), 3) if latencies else None
    summary["samples"] = samples
    return summary


def load(model_id, adapter=None):
    model = load_model(AutoModelForCausalLM, model_id, trust_remote_code=True, device_map={"": 0})
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    return model


def main():
    args = parse_args()
    examples = load_jsonl(args.data)
    tokenizer = AutoTokenizer.from_pretrained(args.adapter or args.model, trust_remote_code=True)
    report = {"data": args.data, "examples": len(examples)}

    student = load(args.model, args.adapter)
    report["student"] = {"model": args.model, "adapter": args.adapter, **evaluate(student, tokenizer, examples, args.max_new_tokens)}
    del student
    torch.cuda.empty_cache()

    if args.compare_base:
        base = load(args.base)
        report["base"] = {"model": args.base, **evaluate(base, tokenizer, examples, args.max_new_tokens)}

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k != "samples"}, indent=2, default=str)[:4000])


if __name__ == "__main__":
    main()
