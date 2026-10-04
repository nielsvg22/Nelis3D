// Generates PWA icons from src/app/icon.svg  →  node scripts/make-icons.mjs
import sharp from "sharp";
import fs from "node:fs";
const svg = fs.readFileSync("src/app/icon.svg");
for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["apple-touch-icon", 180]]) {
  await sharp(svg, { density: 600 }).resize(size, size).png().toFile(`public/icons/${name}.png`);
}
// maskable: full-bleed background with the glyph inside the safe zone
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#111114"/><g transform="translate(5 5) scale(.69)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><path d="m16 7 8 4.5v9L16 25l-8-4.5v-9L16 7Z"/><path d="m16 16 8-4.5M16 16l-8-4.5M16 16v9"/></g></svg>`);
await sharp(bg, { density: 600 }).resize(512, 512).png().toFile("public/icons/maskable-512.png");
console.log("icons written");
