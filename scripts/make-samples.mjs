// Renders the bundled sample photos and app icons with a headless browser.
// Every scene is original: fictional names, no real brands, no people's faces.
// Usage: node scripts/make-samples.mjs   (needs Playwright: npx playwright install chromium)
// Set PLAYWRIGHT_PATH to use a Playwright install from elsewhere.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "samples");

const table = `background: radial-gradient(ellipse at 30% 20%, #b98a5a 0%, #8a5f37 55%, #5f3f22 100%);`;
const page = (body, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1280px;height:960px;overflow:hidden;font-family:Georgia,"Times New Roman",serif}
.scene{position:absolute;inset:0;${table}}
.paper{position:absolute;background:#fbfaf6;box-shadow:0 18px 40px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3)}
.sans{font-family:Helvetica,Arial,sans-serif}
${extra}
</style></head><body><div class="scene">${body}</div></body></html>`;

const scenes = {
  letter: page(
    `<div class="paper" style="left:250px;top:40px;width:780px;height:900px;transform:rotate(-2deg);padding:70px 80px;box-sizing:border-box;font-size:27px;line-height:1.5;color:#1d1d1d">
      <div style="text-align:right;font-size:24px">Riverside Library<br>4 Mill Lane<br>Ashford Green</div>
      <p style="margin-top:40px">12 October 2026</p>
      <p>Dear Sam Okafor,</p>
      <p>Two books you borrowed are due back on 14 November 2026. You can renew them by phone on 0161 496 0142.</p>
      <p>Our opening hours are 9:00 to 17:00, Monday to Saturday.</p>
      <p>Kind regards,<br>Maya Lindqvist<br>Library Services</p>
    </div>`,
  ),
  receipt: page(
    `<div class="paper sans" style="left:420px;top:30px;width:440px;height:900px;transform:rotate(3deg);padding:46px 40px;box-sizing:border-box;font-family:'Courier New',monospace;font-size:26px;color:#222;line-height:1.55">
      <div style="text-align:center;font-weight:bold;font-size:30px">CORNER MARKET</div>
      <div style="text-align:center">18 Station Road</div>
      <div style="text-align:center">23/10/2026 10:42</div>
      <hr style="border:none;border-top:2px dashed #555;margin:22px 0">
      <div style="display:flex;justify-content:space-between"><span>Bread</span><span>2.40</span></div>
      <div style="display:flex;justify-content:space-between"><span>Milk 1L</span><span>1.35</span></div>
      <div style="display:flex;justify-content:space-between"><span>Apples x4</span><span>3.20</span></div>
      <div style="display:flex;justify-content:space-between"><span>Rice 1kg</span><span>5.55</span></div>
      <hr style="border:none;border-top:2px dashed #555;margin:22px 0">
      <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:32px"><span>TOTAL</span><span>$12.50</span></div>
      <div style="display:flex;justify-content:space-between"><span>CARD</span><span>$12.50</span></div>
      <div style="text-align:center;margin-top:40px">Thank you</div>
    </div>`,
  ),
  can_label: page(
    `<div style="position:absolute;left:390px;top:90px;width:500px;height:780px;border-radius:40px/24px;background:linear-gradient(90deg,#7c8186 0%,#d9dde0 18%,#f4f6f7 30%,#aab0b5 60%,#6e7378 100%);box-shadow:0 30px 50px rgba(0,0,0,.5)"></div>
     <div class="sans" style="position:absolute;left:390px;top:220px;width:500px;height:520px;background:linear-gradient(90deg,#7d1410 0%,#c62a1f 22%,#e0432f 35%,#b5221a 65%,#6c100c 100%);color:#fff;text-align:center;box-sizing:border-box;padding-top:60px">
      <div style="font-size:34px;letter-spacing:4px">HILLFIELD</div>
      <div style="font-size:72px;font-weight:bold;line-height:1;margin-top:40px">Chopped<br>Tomatoes</div>
      <div style="font-size:30px;margin-top:30px">in tomato juice</div>
      <div style="font-size:40px;font-weight:bold;margin-top:70px">400 g</div>
    </div>`,
  ),
  microwave: page(
    `<div class="sans" style="position:absolute;left:90px;top:120px;width:1100px;height:700px;background:linear-gradient(180deg,#e9ebec,#c9cdd0);border-radius:18px;box-shadow:0 30px 60px rgba(0,0,0,.5)">
      <div style="position:absolute;left:40px;top:40px;width:700px;height:620px;background:linear-gradient(135deg,#1b1f22,#2c3236 60%,#15181a);border-radius:10px"></div>
      <div style="position:absolute;left:780px;top:40px;width:280px;height:620px;background:#dfe2e4;border-radius:10px;padding:24px;box-sizing:border-box">
        <div style="background:#0d1a10;color:#6dff8a;font-family:'Courier New',monospace;font-size:52px;text-align:center;padding:12px 0;border-radius:6px">12:00</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:26px;font-size:24px;font-weight:bold;color:#222">
          <div style="background:#fff;border:2px solid #999;border-radius:8px;padding:16px 4px;text-align:center">POWER</div>
          <div style="background:#fff;border:2px solid #999;border-radius:8px;padding:16px 4px;text-align:center">DEFROST</div>
          <div style="background:#fff;border:2px solid #999;border-radius:8px;padding:16px 4px;text-align:center">TIMER</div>
          <div style="background:#fff;border:2px solid #999;border-radius:8px;padding:16px 4px;text-align:center">CLOCK</div>
        </div>
        <div style="margin:30px auto 0;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fafafa,#b9bec2);border:3px solid #8d9397"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px;font-size:24px;font-weight:bold">
          <div style="background:#2f9e44;color:#fff;border-radius:8px;padding:18px 4px;text-align:center">START</div>
          <div style="background:#c92a2a;color:#fff;border-radius:8px;padding:18px 4px;text-align:center">STOP</div>
        </div>
      </div>
    </div>
    <div class="paper sans" style="left:850px;top:770px;width:330px;height:150px;padding:14px 18px;box-sizing:border-box;font-size:20px;line-height:1.4;color:#222;background:#f1f1ec">
      <b>ACME HOME</b><br>Model: MW-2041<br>230V ~ 50Hz &nbsp; 800 W
    </div>`,
  ),
  kitchen: page(
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#d9d4c7 0 46%,#7a7f84 46% 48%,#a7aaa3 48% 100%)"></div>
     <div style="position:absolute;left:460px;top:250px;width:220px;height:240px;background:linear-gradient(90deg,#9aa1a6,#eef1f3 35%,#8b9297);border-radius:30px 30px 18px 18px;box-shadow:0 20px 30px rgba(0,0,0,.35)"></div>
     <div style="position:absolute;left:520px;top:215px;width:100px;height:40px;background:#30363b;border-radius:12px 12px 0 0"></div>
     <div style="position:absolute;left:665px;top:300px;width:60px;height:110px;border:16px solid #30363b;border-left:none;border-radius:0 40px 40px 0"></div>
     <div style="position:absolute;left:760px;top:560px;width:380px;height:240px;background:linear-gradient(135deg,#c79a63,#a87a45);border-radius:16px;box-shadow:0 14px 24px rgba(0,0,0,.35)"></div>
     <div style="position:absolute;left:800px;top:650px;width:250px;height:34px;background:linear-gradient(180deg,#f3f5f6,#a8b0b5);clip-path:polygon(0 50%,8% 0,100% 15%,100% 85%,8% 100%);transform:rotate(-12deg)"></div>
     <div style="position:absolute;left:1030px;top:610px;width:110px;height:34px;background:#222;border-radius:8px;transform:rotate(-12deg)"></div>
     <div style="position:absolute;left:180px;top:560px;width:150px;height:170px;background:linear-gradient(90deg,#1f5fa8,#3d80cf 40%,#1a4f8d);border-radius:10px 10px 30px 30px;box-shadow:0 14px 20px rgba(0,0,0,.35)"></div>
     <div style="position:absolute;left:320px;top:590px;width:50px;height:90px;border:14px solid #1f5fa8;border-left:none;border-radius:0 40px 40px 0"></div>`,
  ),
  room: page(
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#e6dfd2 0 55%,#b98d61 55% 100%)"></div>
     <div style="position:absolute;left:60px;top:300px;width:560px;height:280px;background:#f2f2f2;border-radius:14px;box-shadow:0 18px 30px rgba(0,0,0,.3)"></div>
     <div style="position:absolute;left:60px;top:260px;width:560px;height:70px;background:#5d7ea3;border-radius:14px"></div>
     <div style="position:absolute;left:300px;top:640px;width:200px;height:90px;background:#2f6db3;border-radius:40% 50% 30% 60%;transform:rotate(14deg)"></div>
     <div style="position:absolute;left:520px;top:700px;width:180px;height:70px;background:#c0392b;border-radius:50% 30% 60% 40%;transform:rotate(-20deg)"></div>
     <div style="position:absolute;left:150px;top:760px;width:170px;height:80px;background:#3a3a3a;border-radius:30% 60% 40% 50%"></div>
     <div style="position:absolute;left:880px;top:560px;width:240px;height:220px;background:repeating-linear-gradient(90deg,#c8a46a 0 14px,#b28c50 14px 28px);border-radius:12px 12px 40px 40px;box-shadow:0 14px 22px rgba(0,0,0,.3)"></div>
     <div style="position:absolute;left:760px;top:180px;width:420px;height:20px;background:#6b4a2b"></div>
     <div style="position:absolute;left:800px;top:120px;width:40px;height:60px;background:#2b8a3e"></div>
     <div style="position:absolute;left:845px;top:110px;width:34px;height:70px;background:#e67700"></div>
     <div style="position:absolute;left:700px;top:820px;width:120px;height:80px;background:#1864ab;transform:rotate(25deg);box-shadow:0 6px 10px rgba(0,0,0,.3)"></div>
     <div style="position:absolute;left:840px;top:850px;width:120px;height:80px;background:#e03131;transform:rotate(-15deg);box-shadow:0 6px 10px rgba(0,0,0,.3)"></div>`,
  ),
  keys_shelf: page(
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#d8d2c4 0 58%,#6f4c2c 58% 64%,#8a6440 64% 100%)"></div>
     <div style="position:absolute;left:520px;top:480px;width:120px;height:120px;border:12px solid #c9a227;border-radius:50%"></div>
     <div style="position:absolute;left:600px;top:540px;width:210px;height:28px;background:linear-gradient(180deg,#f1f3f5,#9aa3aa);clip-path:polygon(0 0,70% 0,72% 40%,78% 0,84% 40%,90% 0,100% 50%,100% 100%,0 100%);transform:rotate(8deg)"></div>
     <div style="position:absolute;left:590px;top:590px;width:190px;height:26px;background:linear-gradient(180deg,#f1f3f5,#9aa3aa);clip-path:polygon(0 0,75% 0,80% 45%,86% 0,100% 50%,100% 100%,0 100%);transform:rotate(18deg)"></div>
     <div style="position:absolute;left:440px;top:560px;width:80px;height:60px;background:#d6336c;border-radius:10px;transform:rotate(-20deg)"></div>`,
  ),
  sign: page(
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#9fb7c9 0%,#c7d3dc 60%,#8d8f8a 60%)"></div>
     <div class="sans" style="position:absolute;left:300px;top:170px;width:680px;height:470px;background:#0b3d91;border:14px solid #e9ecef;border-radius:18px;color:#fff;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,.4)">
      <div style="font-size:84px;font-weight:bold;margin-top:60px">LIBRARY</div>
      <div style="font-size:44px;margin-top:30px">Open 9:00 to 17:00</div>
      <div style="font-size:44px;margin-top:14px">Monday to Saturday</div>
      <div style="font-size:36px;margin-top:30px">Entrance on the left &larr;</div>
    </div>
    <div style="position:absolute;left:620px;top:640px;width:40px;height:320px;background:#6c757d"></div>`,
  ),
  price_tag: page(
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#f8f9fa 0 30%,#e9ecef 30% 32%,#dee2e6 32%)"></div>
     <div class="sans" style="position:absolute;left:380px;top:300px;width:520px;height:330px;background:#ffe066;border-radius:14px;box-shadow:0 16px 30px rgba(0,0,0,.35);padding:30px;box-sizing:border-box;color:#212529">
      <div style="font-size:40px;font-weight:bold">Oat Biscuits 300 g</div>
      <div style="font-size:120px;font-weight:bold;line-height:1.1;margin-top:20px">$4.99</div>
      <div style="font-size:28px;margin-top:6px">$1.66 per 100 g</div>
    </div>`,
  ),
  crossing: page(
    `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#a5c8e1 0 35%,#5c636a 35% 100%)"></div>
     <div style="position:absolute;left:0;right:0;top:520px;height:420px;background:repeating-linear-gradient(90deg,#f1f3f5 0 90px,transparent 90px 170px);transform:perspective(600px) rotateX(55deg);transform-origin:top"></div>
     <div style="position:absolute;left:1040px;top:120px;width:28px;height:480px;background:#343a40"></div>
     <div style="position:absolute;left:1000px;top:120px;width:110px;height:200px;background:#212529;border-radius:12px"></div>
     <div style="position:absolute;left:1025px;top:140px;width:60px;height:60px;border-radius:50%;background:#7a1f1f"></div>
     <div style="position:absolute;left:1025px;top:230px;width:60px;height:60px;border-radius:50%;background:#2b8a3e"></div>`,
  ),
};

/** Variants that make the honest-uncertainty gates visible. */
const variants = {
  letter_dark: { base: "letter", css: "body{filter:brightness(.035) contrast(.6) blur(1.5px)}" },
  receipt_blurry: { base: "receipt", css: "body{filter:blur(7px)}" },
  letter_cut_off: { base: "letter", css: "body{background:#5f3f22}.scene{transform:translateX(330px) scale(1.05)}" },
};

export const manifest = [
  { id: "letter", title: "A letter", alt: "A printed letter on a wooden table.", suggested: "read" },
  { id: "letter_cut_off", title: "Letter, cut off", alt: "The same letter, with its right side outside the frame.", suggested: "read" },
  { id: "letter_dark", title: "Letter, too dark", alt: "The letter in near darkness.", suggested: "read" },
  { id: "receipt", title: "A receipt", alt: "A shop receipt with a total of 12.50.", suggested: "read" },
  { id: "receipt_blurry", title: "Receipt, blurry", alt: "The receipt, badly out of focus.", suggested: "read" },
  { id: "price_tag", title: "A price tag", alt: "A yellow shelf price tag.", suggested: "read" },
  { id: "can_label", title: "A tin of tomatoes", alt: "A tin of chopped tomatoes.", suggested: "what_is" },
  { id: "kitchen", title: "Kitchen counter", alt: "A kettle, a mug, and a knife on a chopping board.", suggested: "describe" },
  { id: "room", title: "Untidy room", alt: "A bedroom with clothes and books on the floor and a laundry basket.", suggested: "plan" },
  { id: "keys_shelf", title: "Keys on a shelf", alt: "A key ring with two keys and a pink tag on a shelf.", suggested: "find" },
  { id: "microwave", title: "Microwave panel", alt: "A microwave with its control panel and a model label.", suggested: "label" },
  { id: "sign", title: "Library sign", alt: "A blue library sign with opening hours.", suggested: "read" },
  { id: "crossing", title: "Street crossing", alt: "A zebra crossing with a traffic light.", suggested: "describe" },
];

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const render = async (html, file) => {
    await tab.setContent(html, { waitUntil: "load" });
    await tab.screenshot({ path: join(out, file), type: "jpeg", quality: 80 });
  };
  // Each sample also gets a second frame: the same scene with a small hand movement,
  // so the two-frame number check compares two genuinely different images.
  const jitter = "html{background:#5f3f22}body{transform:translate(14px,9px) rotate(0.4deg) scale(1.012);transform-origin:center}";
  await mkdir(join(out, "frame2"), { recursive: true });
  const all = [
    ...Object.entries(scenes).map(([id, html]) => [id, html]),
    ...Object.entries(variants).map(([id, v]) => [id, scenes[v.base].replace("</style>", `${v.css}</style>`)]),
  ];
  for (const [id, html] of all) {
    await render(html, `${id}.jpg`);
    await render(html.replace("</style>", `${jitter}</style>`), join("frame2", `${id}.jpg`));
  }
  await writeFile(join(out, "manifest.json"), `${JSON.stringify({ samples: manifest.map((m) => ({ ...m, file: `${m.id}.jpg` })) }, null, 2)}\n`);

  // App icons from the SVG, including a maskable one with safe-zone padding.
  const svg = (await import("node:fs")).readFileSync(join(root, "public", "icon.svg"), "utf8");
  const iconPage = (size, pad) => `<!doctype html><html><body style="margin:0;background:#0d1013;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace("<svg ", `<svg width="${size - pad * 2}" height="${size - pad * 2}" `)}</div></body></html>`;
  for (const [file, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["icon-maskable-512.png", 512, 64], ["apple-touch-icon.png", 180, 0]]) {
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(iconPage(size, pad));
    await tab.screenshot({ path: join(root, "public", file), type: "png", omitBackground: false });
  }
  await browser.close();
  console.log(`Wrote ${Object.keys(scenes).length + Object.keys(variants).length} samples and 4 icons.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
