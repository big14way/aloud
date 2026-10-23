# Aloud evaluation

Run 2026-10-23T21:10:42.732Z · split: **all** · models: vision `nvidia/Nemotron-3.5-Super-VL`, fast `nvidia/Nemotron-3_5-Lightning`, judge `nvidia/Nemotron-3-Ultra-550b-a55b`

## Memory answers (deterministic reducer)

Scripted sequences (place, pick up, move silently, check with the camera, ambiguous names). Each must produce the right answer status and keep its status words.

- Correct answer status and wording: 100.0% (14/14), small set

## Intent routing

82 labelled spoken requests (synthetic, all). Correct means the right skill and the key argument words.

The rules lane was tuned on the dev split, so its held-out row is the honest one.

| Lane | Split | Accuracy | Valid tool calls | p50 latency | $ per 1K calls |
|---|---|---|---|---|---|
| Rules (offline) | dev | 100.0% (49/49) | 100.0% (49/49) | 0.00 s | $0.000 |
| Rules (offline) | heldout | 78.8% (26/33) | 100.0% (33/33) | 0.00 s | $0.000 |
| Nemotron 3.5 Lightning | dev | 100.0% (49/49) | 100.0% (49/49) | 1.13 s | $0.122 |
| Nemotron 3.5 Lightning | heldout | 87.9% (29/33) | 100.0% (33/33) | 1.18 s | $0.120 |

## Vision answers

Set: **Bundled synthetic samples** (13 photos in this split). These are rendered synthetic scenes, not real photos, so they show the pipeline works end to end; they are not a reliability claim.

Prompts and rules were tuned on dev only. Latency is measured on the server running the evaluation; on a phone, add capture and upload.

| Metric | Dev | Held-out |
|---|---|---|
| Errors (request failed) | 0.0% (0/8), small set | 0.0% (0/5), small set |
| OCR character error rate, text photos (mean) | 3.0% over 3 photos, small set | 1.5% over 2 photos, small set |
| Words read that are not on the page | 0.0% (0/129) | 0.0% (0/21), small set |
| Key-fact recall (photos that should be answered) | 100.0% (14/14), small set | 66.7% (6/9), small set |
| Unsupported sentences in descriptions (judged by Nemotron 3 Ultra) | 27.3% (3/11), small set | 100.0% (6/6), small set |
| Correct abstention on bad shots (guidance only) | 100.0% (1/1), small set | 100.0% (1/1), small set |
| Answered when it should (good shots) | 100.0% (7/7), small set | 100.0% (4/4), small set |
| Hazard mentioned first ("Careful") | 100.0% (1/1), small set | n/a (0 examples) |
| Forbidden-claim violations | 0 (target 0) | 0 (target 0) |
| Numbers spoken that are not on the page | 0 (target 0) | 0 (target 0) |
| Number lines: two frames agreed / Ultra adjudicated / abstained | 21 / 3 / 0 | 4 / 0 / 0 |
| Server latency p50 / p95 | 2.66 s / 13.73 s | 2.18 s / 2.60 s |
| Mean cost per request | $0.00430 | $0.00125 |
| Perception cost per hour of use (120 Describe presses) | $0.097 | $0.109 |

### Per photo

| Photo | Split | Skill | Status | ms | What Aloud said |
|---|---|---|---|---|---|
| letter | dev | read | answered | 13728 | Riverside Library 4 Mill Lane Ashford Green 12 October 2026 Dear Sam Okafor, Two books you borrowed are due back on 14 November 2026. You can renew them by phone on 0161 496 0142. 0161 496 0142 Our opening hours are 9:00 to 17:00, Monday to Saturday. 9:00 17:00 Kind regards, Maya Lindqvist Library Services |
| receipt | dev | read | answered | 4272 | CORNER MARKET 18 Station Road 23/10/2026 10:42 Bread 2.40 Milk 1L 1.35 Apples x4 3.20 Rice 1kg 5.55 TOTAL $12.50 CARD $12.50 Thank you |
| price_tag | heldout | read | answered | 2601 | Oat Biscuits 300 g $4.99 $1.66 per 100 g |
| sign | heldout | read | answered | 2033 | LIBRARY Open 9:00 to 17:00 Monday to Saturday Entrance on the left ← |
| letter_cut_off | dev | read | answered | 3648 | Riverside Library 4 Mill Lane Ashford Green 12 October 2026 Dear Sam Okafor, Two books you borrowed are due back on 14 November 2026. You can renew them by phone on 0161 496 0142. Our opening hours are 9:00 to 17:00, Monday to Saturday. Kind regards, Maya Lindqvist Library Services The text is cut off on the right. Move the phone right. |
| letter_dark | dev | read | guidance | 4446 | Too dark. Try a light, or move toward the window. |
| receipt_blurry | heldout | read | guidance | 2183 | The picture is blurry. Hold the phone still and press again. |
| can_label | dev | what_is | answered | 2208 | This is a red and silver can of Hillfield Chopped Tomatoes in tomato juice, (number unclear) g. The label says "HILLFIELD". The label says "Chopped Tomatoes". Press Read to check the number. |
| kitchen | dev | describe | answered | 1868 | Careful: a knife on a cutting board, blade pointing toward the left at 4 o'clock, within reach. A kitchen countertop within reach. A silver kettle with a black handle and lid at 12 o'clock, within reach. A blue mug with a handle on the right at 8 o'clock, within reach. A tan cutting board with a white knife on it at 4 o'clock, within reach. |
| room | heldout | describe | answered | 2376 | Careful: a dark oval obstacle on the floor at 8 o'clock, within reach. Careful: a blue oval obstacle on the floor at 7 o'clock, within reach. Careful: a red oval obstacle on the floor at 5 o'clock, within reach. Careful: a blue square obstacle on the floor at 5 o'clock, within reach. Careful: a red square obstacle on the floor at 5 o'clock, within reach. A room with a beige wall and brown floor. |
| keys_shelf | dev | what_is | answered | 2657 | This is a yellow keyring with a pink tag and two white keys. |
| microwave | heldout | label | answered | 1787 | This is an ACME HOME microwave, model MW-2041. |
| crossing | dev | describe | answered | 1912 | I can't judge traffic safety. Please rely on your cane, dog, or a crossing signal. A person, within reach, at 6 o'clock. A street intersection. |

