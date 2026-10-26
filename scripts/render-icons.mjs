/**
 * Recreate the extension icon PNGs from the same native geometry as icon.svg.
 * Run: node scripts/render-icons.mjs
 * Requires Python 3 and Pillow; no network access or downloaded assets.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const python = String.raw`
from PIL import Image, ImageDraw
from pathlib import Path
import math, sys

output = Path(sys.argv[1])
background = '#22231f'
amber = '#f5bc46'

def render(size):
    # Oversampling keeps small toolbar icons crisp, with rounded stroke ends.
    scale = max(8, math.ceil(1024 / size))
    canvas_size = size * scale
    factor = canvas_size / 128
    image = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, canvas_size - 1, canvas_size - 1), radius=30 * factor, fill=background)
    width = 7.5 * factor

    def stroke(points):
        coords = [(x * factor, y * factor) for x, y in points]
        draw.line(coords, fill=amber, width=round(width), joint='curve')
        radius = width / 2
        for x, y in (coords[0], coords[-1]):
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=amber)

    # Draw the annular sector as one polygon, avoiding polyline join seams.
    # The sun's core is a power-switch ring, open for the vertical stem.
    def point(radius, angle):
        a = math.radians(angle)
        return ((64 + radius * math.cos(a)) * factor, (66 + radius * math.sin(a)) * factor)
    outer = [point(25.75, a) for a in range(-45, 226)]
    inner = [point(18.25, a) for a in range(225, -46, -1)]
    draw.polygon(outer + inner, fill=amber)
    for a in (-45, 225):
        x, y = point(22, a)
        r = width / 2
        draw.ellipse((x-r, y-r, x+r, y+r), fill=amber)
    stroke([(64, 28), (64, 60)])
    for angle in (0, 45, 90, 135, 180, 225, 315):
        a = math.radians(angle)
        stroke([(64 + r * math.cos(a), 66 + r * math.sin(a)) for r in (36, 44)])

    image.resize((size, size), Image.Resampling.LANCZOS).save(output / f'icon-{size}.png', optimize=True)

for size in (16, 32, 48, 128, 256, 512):
    render(size)
print('Rendered AlwayLight icons: 16, 32, 48, 128, 256, 512 px')
`;

const result = spawnSync('python3', ['-c', python, assets], { encoding: 'utf8' });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
