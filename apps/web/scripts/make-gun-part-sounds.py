"""Gun part sounds for reloads and actions: copies the supplied recordings into
public/sounds/parts/ under stable names, and synthesises the ones not supplied (short metallic
clicks, latches, slams, casings) with numpy so every scripted part has a voice.

Usage (repo root): python apps/web/scripts/make-gun-part-sounds.py <downloads dir>
"""
import shutil
import sys
import wave
from pathlib import Path

import numpy as np

OUT = Path('apps/web/public/sounds/parts')
RATE = 44100

SUPPLIED = {
    'barrels-open.mp3': 'barrels-open.mp3',
    'barrels-close.mp3': 'barrels-close.mp3',
    '40mm-insert.mp3': 'round-40mm-insert.mp3',
    'revolver-spin.mp3': 'cylinder-spin.mp3',
    'magazine.release.out.mp3': 'mag-out.mp3',
    'magazine-insert click.mp3': 'mag-in.mp3',
    'magazine-slap tap.mp3': 'mag-slap.mp3',
    'button-press.mp3': 'button-press.mp3',
    'charging handle pull back.mp3': 'charge-back.mp3',
    'bolt-carriage.mp3': 'bolt-carriage.mp3',
    'gun-aim.mp3': 'gun-aim.mp3',
    'pistol-relaod.mp3': 'slide-rack.mp3',
    'shell-insert.mp3': 'shell-insert.mp3',
    'shotgun-slide-release.mp3': 'action-release.mp3',
    'dragon-studio-gun-reload-2-511308.mp3': 'reload-generic.mp3',
}

rng = np.random.default_rng(13)


def env(n, attack, decay):
    t = np.arange(n) / RATE
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def ring(n, freqs, decay):
    """Metal resonance: a few damped partials."""
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for f, a in freqs:
        out += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t / (decay * rng.uniform(.7, 1.3)))
    return out


def click(dur=.06, body=(2400, 4100, 6900), decay=.012, noise=.6, tone=.5):
    n = int(RATE * dur)
    burst = rng.normal(0, 1, n) * env(n, .0004, decay * .6) * noise
    metal = ring(n, [(f, 1 / (i + 1)) for i, f in enumerate(body)], decay) * tone
    return burst + metal


def place(total, *events):
    out = np.zeros(int(RATE * total))
    for at, sig, gain in events:
        i = int(RATE * at)
        seg = sig[: max(0, len(out) - i)]
        out[i:i + len(seg)] += seg * gain
    return out


def lowpass(x, k=6):
    return np.convolve(x, np.ones(k) / k, mode='same')


def write(name, x, gain=.8):
    x = x / max(1e-6, np.abs(x).max()) * gain
    fade = min(len(x), int(RATE * .01))
    x[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(str(OUT / name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


SYNTH = {
    # Empty chamber: the hammer / striker falls on nothing.
    'dry-fire.wav': lambda: place(.15, (0, click(.08, (1800, 3300, 5200), .015), 1), (.012, click(.05, (5200, 7900), .006, .3), .4)),
    # Fire selector / safety: a small detent click.
    'selector.wav': lambda: place(.1, (0, click(.06, (3800, 6200, 9100), .008, .4), 1)),
    # Bolt handle lifted / turned down (bolt-action rifles).
    'bolt-up.wav': lambda: place(.2, (0, lowpass(click(.12, (1400, 2600, 4300), .03, .5), 3), 1), (.05, click(.05, (3100, 5600), .01, .3), .5)),
    'bolt-down.wav': lambda: place(.2, (0, click(.1, (1600, 2900, 4700), .025), 1)),
    # Bolt / carrier run home: a heavy slam with ring.
    'bolt-forward.wav': lambda: place(.35, (0, lowpass(rng.normal(0, 1, int(RATE * .05)) * env(int(RATE * .05), .002, .015), 4), .7), (.04, click(.25, (900, 1700, 2800, 4400), .06, .7, .8), 1)),
    'charge-release.wav': lambda: place(.35, (0, click(.25, (1100, 2050, 3300, 5100), .055, .8, .7), 1)),
    # Pistol slide let go: snap forward.
    'slide-release.wav': lambda: place(.25, (0, click(.18, (1500, 2700, 4600), .04, .8, .6), 1)),
    # Revolver hammer / launcher hammer cocked: two quick clicks.
    'hammer-cock.wav': lambda: place(.2, (0, click(.05, (2600, 4800), .008), .7), (.07, click(.08, (2100, 3900, 6400), .014), 1)),
    # Revolver cylinder swung out / back in.
    'cylinder-open.wav': lambda: place(.25, (0, click(.06, (2900, 5100), .01, .4), .6), (.04, lowpass(click(.15, (1300, 2400, 3900), .035), 2), 1)),
    'cylinder-close.wav': lambda: place(.25, (0, click(.2, (1250, 2300, 3700, 5600), .045, .7, .7), 1)),
    # Spent cases knocked out (several small tinkles).
    'eject-shells.wav': lambda: place(.7, *[(.02 + i * rng.uniform(.03, .07), click(.18, (rng.uniform(3500, 5200), rng.uniform(6500, 8800), rng.uniform(9500, 12000)), .05, .2, .9), rng.uniform(.4, .9)) for i in range(6)]),
    # One brass case bouncing on a hard floor.
    'casing-drop.wav': lambda: place(.6, *[(t, click(.15, (4200 * k, 7600 * k, 11300 * k), .04, .1, 1), g) for t, k, g in [(0, 1, 1), (.11, 1.02, .55), (.19, .99, .32), (.24, 1.01, .18), (.28, 1, .1)]]),
    # Plastic shotgun shell hitting the floor (duller, lower).
    'shell-drop.wav': lambda: place(.45, *[(t, lowpass(click(.12, (1300, 2600, 4100), .03, .6, .4), 4), g) for t, g in [(0, 1), (.1, .5), (.17, .25)]]),
    # Machine gun feed cover opened / slammed shut, ammo belt laid in the tray.
    'feed-cover-open.wav': lambda: place(.3, (0, click(.06, (2400, 4200), .01), .6), (.05, lowpass(click(.2, (900, 1800, 3000), .05, .5), 2), 1)),
    'feed-cover-close.wav': lambda: place(.35, (0, click(.3, (850, 1650, 2700, 4300), .07, .9, .7), 1)),
    'belt-lay.wav': lambda: place(.5, *[(i * .045, click(.08, (3300 + i * 120, 5900, 8700), .015, .5, .6), .5 + .1 * (i % 2)) for i in range(8)]),
    # Grenade pin pulled out of its hole / the spoon flying off.
    'pin-pull.wav': lambda: place(.25, (0, lowpass(rng.normal(0, 1, int(RATE * .12)) * env(int(RATE * .12), .02, .05), 2) * .5, 1), (.1, click(.1, (5200, 8400, 11800), .03, .3, .9), .8)),
    'spoon-release.wav': lambda: place(.3, (0, click(.2, (2700, 4900, 7600), .05, .3, .9), 1)),
    # Detonator / clacker squeezed.
    'detonator-click.wav': lambda: place(.15, (0, click(.1, (1700, 3100), .02, .7, .5), 1)),
}


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    OUT.mkdir(parents=True, exist_ok=True)
    for name, dest in SUPPLIED.items():
        shutil.copyfile(src / name, OUT / dest)
    for name, make in SYNTH.items():
        write(name, make())
    print(f'{len(SUPPLIED)} copied, {len(SYNTH)} synthesised to {OUT}')


main()
