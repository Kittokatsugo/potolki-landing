import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const SRC = 'img/raw';
const OUT = 'img';

// maxWidth per image — hero big, cards smaller
const SIZES = {
  'hero': 1600,
  'matte': 800,
  'satin': 800,
  'float': 800,
  'work1': 900,
  'before1': 900,
  'before2': 900,
  'before3': 900,
  'before4': 900,
};

const files = readdirSync(SRC).filter(f => /\.(png|jpe?g)$/i.test(f));
let totalIn = 0, totalOut = 0;

for (const f of files) {
  const name = basename(f, extname(f));
  const maxW = SIZES[name] || 1000;
  const inPath = join(SRC, f);
  const outPath = join(OUT, name + '.webp');
  const inSize = statSync(inPath).size;
  totalIn += inSize;

  await sharp(inPath)
    .rotate()
    .resize({ width: maxW, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(outPath);

  const outSize = statSync(outPath).size;
  totalOut += outSize;
  const meta = await sharp(outPath).metadata();
  console.log(`${name}.webp  ${Math.round(inSize/1024)}KB -> ${Math.round(outSize/1024)}KB  ${meta.width}x${meta.height}`);
}

console.log(`\nTOTAL: ${Math.round(totalIn/1024)}KB -> ${Math.round(totalOut/1024)}KB (${Math.round(100 - totalOut/totalIn*100)}% saved)`);
