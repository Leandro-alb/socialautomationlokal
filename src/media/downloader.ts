import path from 'node:path';
import fs from 'node:fs/promises';
import axios from 'axios';
import sharp from 'sharp';
import { withRetry } from '../core/retry';
import { logger } from '../core/logger';
import type { DownloadedImage } from '../types/index';

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const extFromContentType = (contentType?: string): string => {
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('avif')) return 'avif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  return 'jpg';
};

export async function downloadArticleImages(
  imageUrls: string[],
  maxImages: number,
  outputDir: string
): Promise<DownloadedImage[]> {
  await ensureDir(outputDir);

  const limited = imageUrls.slice(0, maxImages);
  const downloaded: DownloadedImage[] = [];

  for (let i = 0; i < limited.length; i += 1) {
    const imageUrl = limited[i];

    const saved = await withRetry(
      async () => {
        const response = await axios.get<ArrayBuffer>(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 25_000,
          maxRedirects: 5
        });

        const ext = extFromContentType(response.headers['content-type']);
        const fileName = `article-img-${String(i + 1).padStart(2, '0')}.${ext}`;
        const tempPath = path.join(outputDir, fileName);

        // Normalize image files to stable JPEGs for slide generation.
        await sharp(Buffer.from(response.data))
          .rotate()
          .jpeg({ quality: 92 })
          .toFile(tempPath.replace(/\.[^.]+$/, '.jpg'));

        return tempPath.replace(/\.[^.]+$/, '.jpg');
      },
      { operationName: `download_image_${i + 1}` }
    );

    downloaded.push({
      url: imageUrl,
      localPath: saved
    });

    logger.info(`Downloaded image ${i + 1}/${limited.length}: ${saved}`);
  }

  return downloaded;
}
