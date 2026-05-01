const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createCanvas, loadImage } = require("../server/node_modules/canvas");

const assetDir = path.resolve(__dirname, "../client/public/product-wall-assets");
const files = fs.readdirSync(assetDir).filter((file) => file.endsWith(".webp") && !file.endsWith("-preview.webp"));

function colorDistance(a, b) {
  return Math.sqrt(
    ((a[0] - b[0]) ** 2)
    + ((a[1] - b[1]) ** 2)
    + ((a[2] - b[2]) ** 2)
  );
}

function isBlank(r, g, b, a, background) {
  if (a < 12) return true;
  return colorDistance([r, g, b], background) < 30 || (r > 235 && g > 235 && b > 235);
}

async function trimImage(input) {
  const tempPng = path.join(os.tmpdir(), `product-wall-${path.basename(input, ".webp")}.png`);
  execFileSync("/opt/homebrew/bin/dwebp", [input, "-o", tempPng], { stdio: "ignore" });

  const image = await loadImage(tempPng);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;
  const samplePoints = [
    [2, 2],
    [image.width - 3, 2],
    [2, image.height - 3],
    [image.width - 3, image.height - 3],
  ];
  const background = samplePoints.reduce((acc, [x, y]) => {
    const index = (y * image.width + x) * 4;
    return [acc[0] + data[index], acc[1] + data[index + 1], acc[2] + data[index + 2]];
  }, [0, 0, 0]).map((value) => value / samplePoints.length);

  let minX = image.width;
  let minY = image.height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      if (!isBlank(data[index], data[index + 1], data[index + 2], data[index + 3], background)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX >= maxX || minY >= maxY) {
    fs.rmSync(tempPng, { force: true });
    return;
  }

  const padding = Math.max(8, Math.round(Math.min(image.width, image.height) * 0.025));
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(image.width - 1, maxX + padding);
  maxY = Math.min(image.height - 1, maxY + padding);

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const outputCanvas = createCanvas(width, height);
  outputCanvas.getContext("2d").drawImage(canvas, minX, minY, width, height, 0, 0, width, height);

  const tempCropped = path.join(os.tmpdir(), `product-wall-${path.basename(input, ".webp")}-crop.png`);
  fs.writeFileSync(tempCropped, outputCanvas.toBuffer("image/png"));

  const output = input.replace(/\.webp$/, "-preview.webp");
  execFileSync("/opt/homebrew/bin/cwebp", ["-quiet", "-q", "92", tempCropped, "-o", output]);
  fs.rmSync(tempPng, { force: true });
  fs.rmSync(tempCropped, { force: true });
  console.log(`${path.basename(input)} -> ${path.basename(output)} (${width}x${height})`);
}

(async () => {
  for (const file of files) {
    await trimImage(path.join(assetDir, file));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
