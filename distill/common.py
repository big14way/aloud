"""Helpers shared by train.py and eval_student.py.

Only the standard library is imported here, so these functions can be tested on
any machine (python -m unittest distill/test_common.py).
"""

import json
import re

# Thinking stays off: the fast lane answers directly, like Lightning with reasoning_effort "none".
TEMPLATE_KWARGS = {"enable_thinking": False}
END_OF_TURN = "<|im_end|>"


def load_model(auto_cls, name, **kwargs):
    """from_pretrained in bf16 across transformers versions ("dtype" is the newer name of "torch_dtype")."""
    import torch

    try:
        return auto_cls.from_pretrained(name, dtype=torch.bfloat16, **kwargs)
    except TypeError:
        return auto_cls.from_pretrained(name, torch_dtype=torch.bfloat16, **kwargs)


def load_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def assistant_message(example):
    """The teacher's answer as a chat message the student's template can render."""
    target = example["target"]
    if "tool_call" in target:
        call = target["tool_call"]
        return {
            "role": "assistant",
            "content": "",
            "tool_calls": [{"type": "function", "function": {"name": call["name"], "arguments": call["arguments"]}}],
        }
    return {"role": "assistant", "content": json.dumps(target["json"], ensure_ascii=False)}


def split_prompt_completion(prompt_text, full_text):
    """The completion is exactly what the model must generate after the inference-time prompt.

    Returns None when the rendered conversation does not extend the generation prompt,
    so a template mismatch can never silently teach the wrong boundary.
    """
    if not full_text.startswith(prompt_text):
        return None
    completion = full_text[len(prompt_text):]
    end = completion.find(END_OF_TURN)
    if end == -1:
        return None
    return completion[: end + len(END_OF_TURN)]


def render(tokenizer, example):
    """(prompt, completion) strings rendered with the student's own chat template."""
    tools = example.get("tools")
    prompt = tokenizer.apply_chat_template(
        example["messages"], tools=tools, tokenize=False, add_generation_prompt=True, **TEMPLATE_KWARGS
    )
    full = tokenizer.apply_chat_template(
        example["messages"] + [assistant_message(example)],
        tools=tools,
        tokenize=False,
        add_generation_prompt=False,
        **TEMPLATE_KWARGS,
    )
    completion = split_prompt_completion(prompt, full)
    return None if completion is None else (prompt, completion)


def strip_thinking(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    if "</think>" in text:
        text = text.split("</think>")[-1]
    return text


def first_json_object(text):
    s = strip_thinking(text).replace("```json", "").replace("```", "")
    start = s.find("{")
    if start == -1:
        return None
    depth, in_string, escaped = 0, False, False
    for i in range(start, len(s)):
        ch = s[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


TOOL_CALL_RE = re.compile(r"<tool_call>\s*<function=([\w\-]+)>(.*?)</function>\s*</tool_call>", re.S)
PARAM_RE = re.compile(r"<parameter=([\w\-]+)>\n?(.*?)\n?</parameter>", re.S)


def parse_tool_call(text):
    """Parse the template's XML tool-call format, or a JSON {"name", "arguments"} fallback."""
    text = strip_thinking(text)
    m = TOOL_CALL_RE.search(text)
    if m:
        return {"name": m.group(1), "arguments": {k: v.strip() for k, v in PARAM_RE.findall(m.group(2))}}
    obj = first_json_object(text)
    if isinstance(obj, dict) and isinstance(obj.get("name"), str):
        args = obj.get("arguments", obj.get("parameters", {}))
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                return None
        if isinstance(args, dict):
            return {"name": obj["name"], "arguments": {k: str(v) for k, v in args.items()}}
    return None


def route_correct(pred, target):
    """Same tool, and every target argument found in the prediction (case-insensitive)."""
    if not pred or pred["name"] != target["name"]:
        return False
    for key, value in target["arguments"].items():
        got = str(pred["arguments"].get(key, "")).lower().strip()
        want = str(value).lower().strip()
        if want and want not in got and got not in want:
            return False
        if want and not got:
            return False
    return True


# --- Rule checks mirrored from shared/easy.ts and server/shape.ts --------------

EASY_MAX_WORDS = 15
HEDGES = ["not sure", "i think", "can't confirm", "last confirmed", "haven't confirmed", "don't have a confirmed", "which one", "careful", "pharmacist", "can't judge"]
JARGON = ["approximately", "utilize", "utilise", "commence", "terminate", "proceed", "subsequently", "sufficient", "assistance", "illuminated", "obstruction", "adjacent to", "ensure", "prior to", "additional", "purchase", "attempt", "retrieve", "receptacle", "facilitate", "numerous", "modify", "configure", "activate", "deactivate"]
CURRENCY = "$€£₦¥₹"
NUM_RE = re.compile(r"[$€£₦¥₹]?\s?\d(?:[\d.,:/\-]*\d)?%?")
THOUSANDS_RE = re.compile(r"^\d{1,3}(,\d{3})+(\.\d+)?$")
DECIMAL_RE = re.compile(r"^\d+(\.\d+)?$")


def word_count(sentence):
    return len([w for w in sentence.split() if re.search(r"\w", w)])


def canonical_number(token):
    compact = re.sub(r"\s+", "", token)
    currency = compact[0] if compact and compact[0] in CURRENCY else ""
    percent = "%" if compact.endswith("%") else ""
    body = compact[len(currency) : len(compact) - len(percent)]
    if THOUSANDS_RE.match(body):
        body = body.replace(",", "")
    if DECIMAL_RE.match(body):
        value = float(body)
        text = str(int(value)) if value == int(value) else repr(value)
        return f"{currency}{text}{percent}"
    return f"{currency}{re.sub(r'[^0-9]', '', body)}{percent}"


def numbers(text):
    return [canonical_number(t) for t in NUM_RE.findall(text)]


def shape_problems(inputs, outputs, keep=()):
    """Every reason an easy-language rewrite is unacceptable. Empty list means it passes."""
    problems = []
    if not outputs:
        return ["empty output"]
    for s in outputs:
        if word_count(s) > EASY_MAX_WORDS:
            problems.append(f"too long: {s}")
        if any(re.search(rf"\b{re.escape(j)}\b", s, re.I) for j in JARGON):
            problems.append(f"jargon: {s}")
    in_text = " ".join(inputs).lower().replace("’", "'")
    out_text = " ".join(outputs).lower().replace("’", "'")
    for h in list(HEDGES) + [k.lower() for k in keep]:
        if h in in_text and h not in out_text:
            problems.append(f'dropped "{h}"')
    in_nums, out_nums = numbers(" ".join(inputs)), numbers(" ".join(outputs))
    problems += [f"dropped number {n}" for n in in_nums if n not in out_nums]
    problems += [f"added number {n}" for n in out_nums if n not in in_nums]
    joined = " ".join(outputs)
    problems += [f'changed quote "{q}"' for q in re.findall(r'"([^"]+)"', " ".join(inputs)) if q not in joined]
    return problems


def plan_problems(plan):
    if not isinstance(plan, dict):
        return ["not an object"]
    steps = plan.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 5:
        return ["needs 1 to 5 steps"]
    texts = [str(s) for s in steps] + [str(plan.get("summary", "")), str(plan.get("encouragement", ""))]
    return [f"too long: {t}" for t in texts if word_count(t) > EASY_MAX_WORDS]


def shape_inputs(example):
    """The sentences a shape example asked to rewrite (the JSON array after the first line)."""
    user = example["messages"][-1]["content"]
    return json.loads(user.split("\n", 1)[1])
