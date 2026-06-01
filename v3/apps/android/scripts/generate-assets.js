/**
 * Generates placeholder app icons and splash screen.
 * Run once: node scripts/generate-assets.js
 * Replace the generated PNGs with real artwork before publishing.
 */
import { createCanvas } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', 'assets');

fs.mkdirSync(ASSETS, { recursive: true });

function drawIcon(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffd8ec';
  ctx.fillRect(0, 0, size, size);

  // Circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = '#c2185b';
  ctx.fill();

  // Nail polish bottle emoji approximation
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.4}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💅', size / 2, size / 2);

  fs.writeFileSync(path.join(ASSETS, filename), canvas.toBuffer('image/png'));
  console.log(`Generated: ${filename}`);
}

function drawSplash(filename) {
  const canvas = createCanvas(1284, 2778);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffd8ec';
  ctx.fillRect(0, 0, 1284, 2778);

  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💅', 642, 1389);

  fs.writeFileSync(path.join(ASSETS, filename), canvas.toBuffer('image/png'));
  console.log(`Generated: ${filename}`);
}

drawIcon(1024, 'icon.png');
drawIcon(1024, 'adaptive-icon.png');
drawSplash('splash.png');

console.log('\nDone! Replace these with real artwork before publishing to the Play Store.');
