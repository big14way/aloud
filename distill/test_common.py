import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from common import (  # noqa: E402
    canonical_number,
    first_json_object,
    parse_tool_call,
    plan_problems,
    route_correct,
    shape_inputs,
    shape_problems,
    split_prompt_completion,
)


class RenderSplit(unittest.TestCase):
    def test_completion_follows_the_generation_prompt(self):
        prompt = "<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n<think></think>"
        full = prompt + '{"a": 1}<|im_end|>\n'
        self.assertEqual(split_prompt_completion(prompt, full), '{"a": 1}<|im_end|>')

    def test_tool_call_completion(self):
        prompt = "<|im_start|>assistant\n<think></think>"
        full = prompt + "\n<tool_call>\n<function=find_object>\n<parameter=object>\nkeys\n</parameter>\n</function>\n</tool_call>\n<|im_end|>\n"
        completion = split_prompt_completion(prompt, full)
        self.assertTrue(completion.startswith("\n<tool_call>"))
        self.assertTrue(completion.endswith("<|im_end|>"))

    def test_mismatch_is_rejected(self):
        self.assertIsNone(split_prompt_completion("abc", "abd<|im_end|>"))


class ToolCalls(unittest.TestCase):
    def test_parses_xml_format(self):
        text = "\n<tool_call>\n<function=remember_placement>\n<parameter=object>\nkeys\n</parameter>\n<parameter=location>\non the hall shelf\n</parameter>\n</function>\n</tool_call>"
        self.assertEqual(parse_tool_call(text), {"name": "remember_placement", "arguments": {"object": "keys", "location": "on the hall shelf"}})

    def test_parses_json_fallback(self):
        self.assertEqual(parse_tool_call('{"name": "find_object", "arguments": "{\\"object\\": \\"wallet\\"}"}'), {"name": "find_object", "arguments": {"object": "wallet"}})

    def test_route_correct(self):
        target = {"name": "find_object", "arguments": {"object": "house keys"}}
        self.assertTrue(route_correct({"name": "find_object", "arguments": {"object": "my house keys"}}, target))
        self.assertFalse(route_correct({"name": "find_object", "arguments": {"object": "wallet"}}, target))
        self.assertFalse(route_correct({"name": "read_text", "arguments": {}}, target))
        self.assertFalse(route_correct(None, target))


class Rules(unittest.TestCase):
    def test_numbers_match_the_typescript_canonical_form(self):
        self.assertEqual(canonical_number("$12.50"), "$12.5")
        self.assertEqual(canonical_number("1,250.00"), "1250")
        self.assertEqual(canonical_number("555-1234"), "5551234")
        self.assertEqual(canonical_number("10:42"), "10:42")
        self.assertNotEqual(canonical_number("1/2"), canonical_number("12"))

    def test_shape_problems(self):
        self.assertEqual(shape_problems(["It costs $12.50."], ["It costs $12.50."]), [])
        problems = shape_problems(['I think it says "EXIT", but I\'m not sure.'], ["It says EXTT."])
        self.assertIn('dropped "not sure"', problems)
        self.assertIn('changed quote "EXIT"', problems)
        self.assertTrue(any(p.startswith("too long") for p in shape_problems(["x"], ["one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"])))

    def test_plan_problems(self):
        self.assertEqual(plan_problems({"summary": "Tidy up.", "steps": ["Put the clothes in the basket."], "encouragement": "Nice."}), [])
        self.assertEqual(plan_problems({"steps": []}), ["needs 1 to 5 steps"])

    def test_json_extraction(self):
        self.assertEqual(first_json_object('<think>x</think>```json\n{"a": "}"}\n```'), {"a": "}"})

    def test_shape_inputs(self):
        ex = {"messages": [{"role": "user", "content": "Rewrite these sentences:\n" + json.dumps(["One.", "Two."])}]}
        self.assertEqual(shape_inputs(ex), ["One.", "Two."])


if __name__ == "__main__":
    unittest.main()
