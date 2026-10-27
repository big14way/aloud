#!/usr/bin/env python3
"""Phone scenes for the Aloud demo video: the user's own iPhone screen recordings, keeping
Aloud's real voice, inside a phone frame, with a short narrator lead-in and captions timed
to the speech. Writes .build/<id>.mp4 in the same format build_demo.py uses (1920x1080,
30 fps, 24 kHz mono AAC), so build_final.py can crossfade them with the other scenes.

  python3 phone_scenes.py [ph1,ph2,ph3]
"""
import hashlib, json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.build')
FONTS = os.path.expanduser('~/.claude/skills/pitch-video/assets/fonts/')
W, H, FPS = 1920, 1080, 30
INK, INK_SOFT, ACCENT, PANEL = '#f5f7f9', '#b4bec8', '#ffd34d', '#171c21'
VOICE, RATE = 'en-US-AndrewMultilingualNeural', '+10%'
PHONE_GAIN_DB = -6  # Aloud's voice on the recordings is about 8 dB louder than the narration
DEV_H = 960

f_display = lambda s: ImageFont.truetype(FONTS + 'barlowsc-700.ttf', s)
f_bold = lambda s: ImageFont.truetype(FONTS + 'barlow-700.ttf', s)
f_semi = lambda s: ImageFont.truetype(FONTS + 'barlow-600.ttf', s)

# Source times are seconds in the phone recording. Captions use source times too and are
# mapped onto the cut. Lines are what Aloud said (from the audio), or what the user said
# (from the "You said" line in the app; the iPhone doesn't record the mic during dictation).
SCENES = {
    'ph1': {
        'src': 'phone/phone1.mp4', 'step': '01', 'head': 'On a real phone: one tap',
        'sub': 'Hazards first, clock positions, and it says when it is not sure.',
        'cut': [[5.6, 10.4], [10.4, 17.45], [24.75, 30.1]],
        'vo': 'On a real phone, one tap describes the scene, hazards first.', 'vo_at': 0.4,
        'captions': [
            ('ALOUD', 10.45, 17.45, "Careful: I think there's a white mug on the table, possibly hot, at 5 o'clock, within reach, but I'm not sure."),
            ('ALOUD', 24.8, 30.1, "I think there's a black smartphone on the table at 9 o'clock, within reach, but I'm not sure."),
        ],
    },
    'ph2': {
        'src': 'phone/phone2.mp4', 'step': '02', 'head': 'Reading a handwritten note',
        'sub': 'Word for word, and it says when the page is cut off.',
        'cut': [[2.4, 16.0]],
        'vo': 'Read gives the words exactly as written.', 'vo_at': 0.4,
        'captions': [
            ('ALOUD', 6.75, 12.6, "Doctor's appointment. Friday, October 30. 10:30 a.m., Room 12."),
            ('ALOUD', 12.65, 16.0, 'The text is cut off on the right. Move the phone right.'),
        ],
    },
    'ph3': {
        'src': 'phone/phone3.mp4', 'step': '05', 'head': 'Where did I put my keys?',
        'sub': 'Hold the button and talk. The memory stays on the phone.',
        'cut': [[15.4, 19.6], [22.8, 25.4], [27.9, 31.45], [45.2, 48.6], [50.8, 52.8], [53.9, 58.0]],
        'vo': 'Hold to talk. The camera checks that these really are your keys.', 'vo_at': 0.4,
        'vo2': 'Later, just ask.', 'vo2_src': 45.3,
        'captions': [
            ('YOU', 15.6, 25.4, "I'm putting my keys on the table."),
            ('ALOUD', 28.0, 31.45, 'Got it. Your keys: on the table, confirmed.'),
            ('YOU', 45.4, 52.8, 'Where are my keys?'),
            ('ALOUD', 54.0, 58.0, 'Your keys: on the table, confirmed today at 8:55.'),
        ],
    },
}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(' '.join(cmd)[:600]); print(r.stderr[-3000:]); sys.exit(1)


def dur_of(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).decode())


def tts(text, sid):
    h = hashlib.md5((VOICE + RATE + text).encode()).hexdigest()[:10]
    path = os.path.join(OUT, f'{sid}_{h}.mp3')
    for _ in range(3):
        if not os.path.exists(path) or os.path.getsize(path) < 1000:
            run(['edge-tts', '--voice', VOICE, f'--rate={RATE}', '--text', text, '--write-media', path])
        try:
            return path, dur_of(path)
        except subprocess.CalledProcessError:
            os.remove(path)
    sys.exit(f'narration for {sid} failed')


def wrap(d, text, fnt, maxw):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=fnt) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines


def to_scene(t, cut):
    """Map a source time onto the cut's timeline (clamped into the nearest kept range)."""
    acc = 0.0
    for a, b in cut:
        if t < a: return acc
        if t <= b: return acc + (t - a)
        acc += b - a
    return acc


def render_static(sc, path):
    bg = Image.open(os.path.join(OUT, 'bg.png')).convert('RGBA')
    d = ImageDraw.Draw(bg)
    x, y = 120, 230
    d.text((x, y), sc['step'], font=f_display(120), fill=ACCENT); y += 150
    d.rounded_rectangle((x, y, x + 96, y + 6), radius=3, fill=INK); y += 34
    for line in wrap(d, sc['head'], f_bold(64), 980): d.text((x, y), line, font=f_bold(64), fill=INK); y += 76
    y += 10
    for line in wrap(d, sc['sub'], f_semi(32), 980): d.text((x, y), line, font=f_semi(32), fill=INK_SOFT); y += 42
    bg.save(path)
    return y + 40


def render_caption(who, text, top, path):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x0, x1 = 120, 1180
    fnt = f_bold(40); lines = wrap(d, text, fnt, x1 - x0 - 64)
    h = 56 + 52 * len(lines) + 34
    d.rounded_rectangle((x0, top, x1, top + h), radius=24, fill=PANEL, outline=ACCENT if who == 'ALOUD' else '#5d6873', width=3)
    label = 'ALOUD SAYS' if who == 'ALOUD' else 'YOU SAY'
    d.text((x0 + 32, top + 22), label, font=f_display(26), fill=ACCENT if who == 'ALOUD' else INK_SOFT)
    yy = top + 60
    for line in lines: d.text((x0 + 32, yy), line, font=fnt, fill=INK); yy += 52
    im.save(path)


def build(sid):
    sc = SCENES[sid]
    src = os.path.join(HERE, sc['src'])
    cut = sc['cut']; clip_len = sum(b - a for a, b in cut)
    static = os.path.join(OUT, f'{sid}_static.png'); cap_top = render_static(sc, static)
    caps = []
    for i, (who, a, b, text) in enumerate(sc['captions']):
        p = os.path.join(OUT, f'{sid}_cap{i}.png'); render_caption(who, text, cap_top, p)
        caps.append((p, to_scene(a, cut), to_scene(b, cut)))
    # phone frame: scale the portrait recording to DEV_H, round the corners, add a shadow
    sw, sh = map(int, subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).decode().strip().split(','))
    dw = int(round(sw * DEV_H / sh)); dw -= dw % 2
    mask = os.path.join(OUT, f'pmask_{dw}.png'); m = Image.new('L', (dw, DEV_H), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, dw - 1, DEV_H - 1), radius=52, fill=255); m.save(mask)
    pad = 90; shd = os.path.join(OUT, f'pshadow_{dw}.png')
    s = Image.new('RGBA', (dw + 2 * pad, DEV_H + 2 * pad), (0, 0, 0, 0)); ImageDraw.Draw(s).rounded_rectangle((pad, pad + 24, pad + dw, pad + DEV_H + 24), radius=52, fill=(0, 0, 0, 150)); s.filter(ImageFilter.GaussianBlur(34)).save(shd)
    dx, dy = W - 210 - dw, (H - DEV_H) // 2
    vo, vo_len = tts(sc['vo'], sid)
    inputs = ['-framerate', str(FPS), '-loop', '1', '-t', str(clip_len), '-i', static, '-i', src,
              '-framerate', str(FPS), '-loop', '1', '-t', str(clip_len), '-i', mask,
              '-framerate', str(FPS), '-loop', '1', '-t', str(clip_len), '-i', shd]
    for p, _, _ in caps: inputs += ['-framerate', str(FPS), '-loop', '1', '-t', str(clip_len), '-i', p]
    n0 = 4 + len(caps)
    inputs += ['-i', vo]
    vf = ''.join(f"[1:v]trim=start={a}:end={b},setpts=PTS-STARTPTS,fps={FPS}[v{i}];[1:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}];" for i, (a, b) in enumerate(cut))
    vf += ''.join(f'[v{i}]' for i in range(len(cut))) + f'concat=n={len(cut)}:v=1:a=0,scale={dw}:{DEV_H},format=rgba[pv];'
    vf += ''.join(f'[a{i}]' for i in range(len(cut))) + f'concat=n={len(cut)}:v=0:a=1,volume={PHONE_GAIN_DB}dB[pa];'
    vf += '[pv][2:v]alphamerge[dev];'
    vf += f'[0:v][3:v]overlay=x={dx - pad}:y={dy - pad}[b0];[b0][dev]overlay=x={dx}:y={dy}[b1];'
    prev = '[b1]'
    for i, (_, a, b) in enumerate(caps):
        vf += f"{prev}[{4 + i}:v]overlay=x=0:y=0:enable='between(t,{a:.2f},{b + 0.25:.2f})'[c{i}];"; prev = f'[c{i}]'
    vf += f'{prev}fade=t=in:st=0:d=0.5,trim=duration={clip_len},format=yuv420p[v]'
    af = f"[{n0}:a]adelay={int(sc['vo_at'] * 1000)}|{int(sc['vo_at'] * 1000)}[n1];"
    mix = ['[pa]', '[n1]']
    if sc.get('vo2'):
        vo2, _ = tts(sc['vo2'], sid + 'b'); inputs += ['-i', vo2]
        t2 = to_scene(sc['vo2_src'], cut)
        af += f"[{n0 + 1}:a]adelay={int(t2 * 1000)}|{int(t2 * 1000)}[n2];"; mix.append('[n2]')
    af += ''.join(mix) + f'amix=inputs={len(mix)}:normalize=0:duration=first,aresample=24000,aformat=channel_layouts=mono,atrim=0:{clip_len}[a]'
    out = os.path.join(OUT, f'{sid}.mp4')
    run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', vf + ';' + af, '-map', '[v]', '-map', '[a]', '-r', str(FPS),
         '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-t', str(clip_len), out])
    print(f'{sid} phone  {clip_len:5.1f}s  (lead-in narration {vo_len:.1f}s)')


if __name__ == '__main__':
    ids = sys.argv[1].split(',') if len(sys.argv) > 1 else list(SCENES)
    for sid in ids: build(sid)
