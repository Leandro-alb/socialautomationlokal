import path from 'node:path';
import fs from 'node:fs/promises';
import { createCanvas, loadImage, type CanvasRenderingContext2D } from 'canvas';
import type { Platform } from '../types/index';
import { logger } from '../core/logger';

const DIMENSIONS: Record<Platform, { width: number; height: number }> = {
  instagram: { width: 1080, height: 1350 },
  tiktok: { width: 1080, height: 1920 }
};

interface SlideInput {
  platform: Platform;
  title: string;
  imagePaths: string[];
  hooks: string[];
  outputDir: string;
}

interface WrappedText {
  fontSize: number;
  lines: string[];
  lineHeight: number;
}

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = ctx.measureText(candidate).width;
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
};

const fitText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  maxFont = 92,
  minFont = 26
): WrappedText => {
  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 2) {
    ctx.font = `bold ${fontSize}px \"Arial Black\", \"Helvetica Neue\", sans-serif`;
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = Math.floor(fontSize * 1.2);
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= maxHeight) {
      return { fontSize, lines, lineHeight };
    }
  }

  ctx.font = `bold ${minFont}px \"Arial Black\", \"Helvetica Neue\", sans-serif`;
  const lines = wrapText(ctx, text, maxWidth);
  return { fontSize: minFont, lines, lineHeight: Math.floor(minFont * 1.2) };
};

const drawCoverImage = async (
  ctx: CanvasRenderingContext2D,
  imagePath: string,
  width: number,
  height: number
): Promise<void> => {
  const image = await loadImage(imagePath);
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
};

const drawBrandedBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void => {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#121212');
  gradient.addColorStop(1, '#313131');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, 0, width, height);
};

export async function generateSlides({
  platform,
  title,
  imagePaths,
  hooks,
  outputDir
}: SlideInput): Promise<string[]> {
  await ensureDir(outputDir);
  const { width, height } = DIMENSIONS[platform];
  const slideCount = imagePaths.length === 0 ? 1 : imagePaths.length;
  const outPaths: string[] = [];

  for (let i = 0; i < slideCount; i += 1) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const imagePath = imagePaths[i];
    if (imagePath) {
      try {
        await drawCoverImage(ctx, imagePath, width, height);
      } catch {
        drawBrandedBackground(ctx, width, height);
      }
    } else {
      drawBrandedBackground(ctx, width, height);
    }

    const overlayHeight = Math.floor(height * 0.36);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, height - overlayHeight, width, overlayHeight);

    const padding = 100;
    const textMaxWidth = Math.floor(width * 0.8);
    const textMaxHeight = overlayHeight - padding;
    const hookText = hooks[i] || title;

    const fitted = fitText(ctx, hookText, textMaxWidth, textMaxHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${fitted.fontSize}px \"Arial Black\", \"Helvetica Neue\", sans-serif`;

    const totalHeight = fitted.lines.length * fitted.lineHeight;
    let y = height - overlayHeight + (overlayHeight - totalHeight) / 2;

    for (const line of fitted.lines) {
      const x = (width - ctx.measureText(line).width) / 2;
      ctx.fillText(line, x, y);
      y += fitted.lineHeight;
    }

    ctx.font = `bold 28px \"Arial Black\", \"Helvetica Neue\", sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(`${i + 1}/${slideCount}`, padding, height - 70);

    const outPath = path.join(
      outputDir,
      `${platform}-slide-${String(i + 1).padStart(2, '0')}.jpg`
    );

    await fs.writeFile(outPath, canvas.toBuffer('image/jpeg', { quality: 0.92 }));
    outPaths.push(outPath);
  }

  logger.info(`Generated ${outPaths.length} ${platform} slide(s)`);
  return outPaths;
}
