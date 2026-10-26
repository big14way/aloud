# Demo video: laptop part

Built with Playwright recordings of the app on sample photos, Pillow slides and Edge neural narration. Clips and renders stay outside git; `scenes.json` records the clips (local app on port 5173, API on 8787) and `demo.json` cuts and narrates them. Phone footage is added in the final cut.

| Scene | On screen | Narration |
|---|---|---|
| t0 | One press, and it tells you what's in front of you. And when it isn't sure. | This is Aloud. One press, and it tells a blind person what's in front of them. And when it isn't sure, it says so. |
| p1 | If you can't see the page, you can't check the answer. | At least two point two billion people live with a vision impairment. If you can't see the page, you can't check what an assistant tells you, and a wrong price sounds as sure as a right one. Aloud is built to say when it isn't sure. |
| d1 | Read: the text, word for word | On a laptop, sample photos stand in for the camera, so anyone can try every skill. Read gives the text word for word, in reading order. |
| d2 | A bad shot gets guidance, not a guess | If the page is cut off, it tells you which way to move the phone. If it's too dark, it gives guidance, and reads nothing it can't see. |
| d3 | Numbers only when two frames agree | Numbers are spoken only when two frames agree. If they don't, Nemotron 3 Ultra compares the two reads, or Aloud says it can't confirm. Each answer lists the models it used. |
| d4 | It remembers what it can prove | Aloud remembers where you put things. The camera checks that these really are your keys, and the place stays on the phone. Ask later, and it answers with what it can prove: confirmed, and when. |
| d5 | Appliances: Tavily finds the manual | For appliances, it reads the model number, and Tavily searches and extracts the manual. This sample's model is made up, so Aloud says it found no clear steps, instead of inventing them. |
| d6 | With a real model number | With a real model number, Tavily finds the maker's manual, and Nemotron 3 Super turns it into three steps, each with something the camera can check. |
| d7 | Simple mode: one short step at a time | Simple mode is for people with cognitive disabilities: one short step at a time, with encouragement. |
| d8 | Some things it never guesses | And some things it never guesses. It won't judge traffic, identify people, or give dosing advice, and that's enforced in code, not just in a prompt. |
| h1 | Four Nemotron models, one job each | Under the hood, four Nemotron models on Nebius Token Factory each have one job: Super VL sees, with reasoning off for speed; Lightning routes; Super turns manuals into steps; and Ultra settles two disagreeing reads. Code decides what's safe to say. |
| e1 | What the evaluation shows | On the test set, Aloud spoke nothing that wasn't on the page, broke no safety rules, and met every bad shot with guidance, for about eleven cents an hour of use. The photos are rendered, so a real-photo set is next. |
| z1 | Try it yourself, / with the sample photos. | Aloud. Try it yourself with the sample photos, at get aloud dot vercel dot app. |

Sources for the numbers: [docs/eval.md](../eval.md) for the evaluation slide; WHO, *Blindness and vision impairment* fact sheet (2023), for "at least 2.2 billion people". The appliance replay (scene d6) is a real `/api/appliance` call made on 26 October 2026, with the brand left out of the video.
