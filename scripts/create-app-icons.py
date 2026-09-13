from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'public' / 'icons'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (1024, 1024), '#285be8')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((240, 256, 784, 704), radius=28, fill='white')
draw.polygon([(300, 684), (300, 810), (464, 684)], fill='white')
for endpoint, y in [(680, 424), (600, 540)]:
    draw.line((344, y, endpoint, y), fill='#285be8', width=38)
    for x in [344, endpoint]:
        draw.ellipse((x-19, y-19, x+19, y+19), fill='#285be8')
for name, size in [('app-192', 192), ('app-512', 512), ('maskable-512', 512), ('apple-touch-icon', 180)]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / (name + '.png'))
print('Created app icons: 192, 512, maskable 512, Apple 180.')
