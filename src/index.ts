import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { loadEnv } from './core/env';
import { logger } from './core/logger';
import { toErrorMessage } from './core/errors';
import { fetchLatestGastroNewsArticle } from './scraper/gastronews';
import { downloadArticleImages } from './media/downloader';
import { generateSlides } from './media/slides';
import { generateCopyWithOpenAI } from './llm/generateCopy';
import { PostizClient } from './postiz/client';
import type { Platform, UploadedMedia } from './types/index';

const runtimeFlagDryRun = process.argv.includes('--dry-run');

const resolveIntegrationId = (
  platform: Platform,
  envIntegrationId: string | undefined,
  list: Array<{ id: string; identifier: string }>
): string | undefined => {
  if (envIntegrationId) {
    return envIntegrationId;
  }

  return list.find((item) => item.identifier === platform)?.id;
};

async function uploadSlidesInOrder(
  client: PostizClient,
  slidePaths: string[]
): Promise<UploadedMedia[]> {
  const uploaded: UploadedMedia[] = [];

  for (const slidePath of slidePaths) {
    const media = await client.uploadMedia(slidePath);
    uploaded.push(media);
    logger.info(`Uploaded media: ${media.id} -> ${media.path}`);
  }

  return uploaded;
}

async function run(): Promise<void> {
  const env = loadEnv();
  const dryRun = runtimeFlagDryRun || env.DRY_RUN;
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');

  const downloadDir = path.resolve(process.cwd(), 'data', 'downloads', runStamp);
  const slideDirBase = path.resolve(process.cwd(), 'data', 'slides', runStamp);

  await fs.mkdir(downloadDir, { recursive: true });
  await fs.mkdir(slideDirBase, { recursive: true });

  logger.info('Starting pipeline');
  logger.info(`Dry run mode: ${dryRun}`);

  const article = await fetchLatestGastroNewsArticle(env.ARTICLE_SOURCE_URL);
  logger.info(`Latest article: ${article.title}`);
  logger.info(`Article URL: ${article.sourceUrl}`);
  logger.info(`Found image URLs: ${article.imageUrls.length}`);

  const downloadedImages = await downloadArticleImages(
    article.imageUrls,
    env.MAX_IMAGES,
    downloadDir
  );

  const slideCount = downloadedImages.length > 0 ? downloadedImages.length : 1;
  logger.info(`Using slide count: ${slideCount}`);

  const generatedCopy = await generateCopyWithOpenAI({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    article,
    slideCount
  });

  const instagramSlides = await generateSlides({
    platform: 'instagram',
    title: article.title,
    imagePaths: downloadedImages.map((img) => img.localPath),
    hooks: generatedCopy.instagram.hooks,
    outputDir: path.join(slideDirBase, 'instagram')
  });

  const tiktokSlides = await generateSlides({
    platform: 'tiktok',
    title: article.title,
    imagePaths: downloadedImages.map((img) => img.localPath),
    hooks: generatedCopy.tiktok.hooks,
    outputDir: path.join(slideDirBase, 'tiktok')
  });

  if (dryRun) {
    logger.info('Dry-run active: skipping Postiz upload/publish');
    logger.info(`Instagram slides: ${instagramSlides.length}, TikTok slides: ${tiktokSlides.length}`);
    return;
  }

  const postiz = new PostizClient({
    baseUrl: env.POSTIZ_BASE_URL,
    apiKey: env.POSTIZ_API_KEY,
    publicUploadBaseUrl: env.POSTIZ_PUBLIC_UPLOAD_BASE_URL
  });

  const health = await postiz.healthCheck();
  logger.info(`Postiz connected: ${health.connected}`);

  const integrations = await postiz.listIntegrations();
  logger.info(`Found integrations: ${integrations.length}`);

  const instagramIntegrationId = resolveIntegrationId(
    'instagram',
    env.POSTIZ_INSTAGRAM_INTEGRATION_ID,
    integrations
  );
  const tiktokIntegrationId = resolveIntegrationId(
    'tiktok',
    env.POSTIZ_TIKTOK_INTEGRATION_ID,
    integrations
  );

  if (!instagramIntegrationId && !tiktokIntegrationId) {
    throw new Error(
      'No target integrations found. Set POSTIZ_INSTAGRAM_INTEGRATION_ID and/or POSTIZ_TIKTOK_INTEGRATION_ID.'
    );
  }

  if (instagramIntegrationId) {
    logger.info(`Publishing Instagram post to integration ${instagramIntegrationId}`);
    const uploaded = await uploadSlidesInOrder(postiz, instagramSlides);
    const response = await postiz.createPostNow({
      platform: 'instagram',
      integrationId: instagramIntegrationId,
      content: generatedCopy.instagram.caption,
      media: uploaded
    });
    logger.info(`Instagram publish response: ${JSON.stringify(response)}`);
  } else {
    logger.warn('Instagram integration ID not set/found. Skipping Instagram publish.');
  }

  if (tiktokIntegrationId) {
    logger.info(`Publishing TikTok post to integration ${tiktokIntegrationId}`);
    const uploaded = await uploadSlidesInOrder(postiz, tiktokSlides);
    const response = await postiz.createPostNow({
      platform: 'tiktok',
      integrationId: tiktokIntegrationId,
      content: generatedCopy.tiktok.caption,
      media: uploaded
    });
    logger.info(`TikTok publish response: ${JSON.stringify(response)}`);
  } else {
    logger.warn('TikTok integration ID not set/found. Skipping TikTok publish.');
  }

  logger.info('Pipeline finished successfully');
}

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${toErrorMessage(reason)}`);
  process.exitCode = 1;
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${toErrorMessage(error)}`);
  process.exit(1);
});

run().catch((error) => {
  logger.error(`Pipeline failed: ${toErrorMessage(error)}`);
  process.exit(1);
});
