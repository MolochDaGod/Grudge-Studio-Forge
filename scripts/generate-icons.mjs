import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../artifacts/game-forge/public/bossgrudge-source.png");
const OUT = resolve(__dirname, "../artifacts/game-forge/public");
const BG = { r: 10, g: 10, b: 15, alpha: 1 };

async function generate() {
  const meta = await sharp(SRC).metadata();
  console.log(`Source: ${meta.width}x${meta.height}`);

  // favicon.ico (32x32 PNG — all modern browsers accept it)
  await sharp(SRC).resize(32, 32, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "favicon.ico"));
  console.log("+ favicon.ico (32x32)");

  // favicon-16.png
  await sharp(SRC).resize(16, 16, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "favicon-16.png"));
  console.log("+ favicon-16.png");

  // favicon-32.png
  await sharp(SRC).resize(32, 32, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "favicon-32.png"));
  console.log("+ favicon-32.png");

  // apple-touch-icon.png (180x180)
  await sharp(SRC).resize(180, 180, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "apple-touch-icon.png"));
  console.log("+ apple-touch-icon.png (180x180)");

  // pwa-192.png
  await sharp(SRC).resize(192, 192, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "pwa-192.png"));
  console.log("+ pwa-192.png");

  // pwa-512.png
  await sharp(SRC).resize(512, 512, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "pwa-512.png"));
  console.log("+ pwa-512.png");

  // pwa-512-maskable.png (10% safe zone padding)
  const inner = Math.round(512 * 0.8);
  const pad = Math.round((512 - inner) / 2);
  const innerBuf = await sharp(SRC).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: innerBuf, left: pad, top: pad }])
    .png().toFile(resolve(OUT, "pwa-512-maskable.png"));
  console.log("+ pwa-512-maskable.png (maskable)");

  // logo.png (512x512)
  await sharp(SRC).resize(512, 512, { fit: "contain", background: BG }).png().toFile(resolve(OUT, "logo.png"));
  console.log("+ logo.png (512x512)");

  // opengraph.jpg (1200x630, logo centered)
  const logoBuf = await sharp(SRC).resize(400, 400, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: { r: 5, g: 6, b: 8, alpha: 1 } } })
    .composite([{ input: logoBuf, left: 400, top: 115 }])
    .jpeg({ quality: 90 }).toFile(resolve(OUT, "opengraph.jpg"));
  console.log("+ opengraph.jpg (1200x630)");

  console.log("\nDone — all icons generated from bossgrudge.");
}

generate().catch(e => { console.error(e); process.exit(1); });
