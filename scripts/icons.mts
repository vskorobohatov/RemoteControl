import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (target: string) => fileURLToPath(new URL(target, import.meta.url));

const iconsDir = at("../web/public/icons");

const targets = [
  { svg: "icon.svg", png: "icon-192.png", size: 192 },
  { svg: "icon.svg", png: "icon-512.png", size: 512 },
  { svg: "icon.svg", png: "apple-touch-icon.png", size: 180 },
  { svg: "icon-maskable.svg", png: "maskable-512.png", size: 512 },
];

for (const target of targets) {
  const source = await readFile(path.join(iconsDir, target.svg));
  await sharp(source, { density: 300 })
    .resize(target.size, target.size)
    .png()
    .toFile(path.join(iconsDir, target.png));
  console.log(`${target.svg} -> ${target.png} (${target.size}x${target.size})`);
}
