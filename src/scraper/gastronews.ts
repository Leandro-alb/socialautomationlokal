import axios from 'axios';
import * as cheerio from 'cheerio';
import { AppError } from '../core/errors';
import { withRetry } from '../core/retry';
import type { ArticleData } from '../types/index';

const isArticleLikePath = (href: string): boolean => {
  if (!href) return false;
  return /\/\d{4}\/\d{2}\/\d{2}\//.test(href) || href.includes('/archiv/');
};

const toAbsoluteUrl = (baseUrl: string, href: string): string => {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const unique = (arr: string[]): string[] => [...new Set(arr)];

function extractLatestArticleUrl(homeHtml: string, sourceUrl: string): string {
  const $ = cheerio.load(homeHtml);

  const articleHrefs: string[] = [];

  $('article a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && isArticleLikePath(href)) {
      articleHrefs.push(toAbsoluteUrl(sourceUrl, href));
    }
  });

  if (articleHrefs.length === 0) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && isArticleLikePath(href)) {
        articleHrefs.push(toAbsoluteUrl(sourceUrl, href));
      }
    });
  }

  const latest = unique(articleHrefs).find((href) => href.includes(sourceUrl));
  if (!latest) {
    throw new AppError('No article URL found on homepage', 'SCRAPER_NO_ARTICLE_URL');
  }

  return latest;
}

function extractArticleContent(articleHtml: string, articleUrl: string): ArticleData {
  const $ = cheerio.load(articleHtml);

  const title =
    normalizeWhitespace($('h1.gn-article-title').first().text()) ||
    normalizeWhitespace($('h1').first().text()) ||
    normalizeWhitespace($('meta[property="og:title"]').attr('content') || '');

  if (!title) {
    throw new AppError('Article title not found', 'SCRAPER_NO_TITLE');
  }

  const contentRoot = $('.gn-article-content').first();
  const textChunks: string[] = [];

  if (contentRoot.length > 0) {
    contentRoot.find('h2, h3, p, li').each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text) textChunks.push(text);
    });
  } else {
    $('article p').each((_, el) => {
      const text = normalizeWhitespace($(el).text());
      if (text) textChunks.push(text);
    });
  }

  const content = textChunks.join('\n');
  if (!content) {
    throw new AppError('Article content not found', 'SCRAPER_NO_CONTENT');
  }

  const imageCandidates: string[] = [];

  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    imageCandidates.push(toAbsoluteUrl(articleUrl, ogImage));
  }

  $('img.gn-article-hero-img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) imageCandidates.push(toAbsoluteUrl(articleUrl, src));
  });

  $('.gn-gallery-item').each((_, el) => {
    const href = $(el).attr('href');
    if (href) imageCandidates.push(toAbsoluteUrl(articleUrl, href));

    const imgSrc = $(el).find('img').attr('src');
    if (imgSrc) imageCandidates.push(toAbsoluteUrl(articleUrl, imgSrc));
  });

  $('.gn-article-content img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) imageCandidates.push(toAbsoluteUrl(articleUrl, src));
  });

  const imageUrls = unique(
    imageCandidates
      .map((url) => url.split('?')[0])
      .filter((url) => /\.(png|jpg|jpeg|webp|avif)$/i.test(url))
  );

  const publishedAt = normalizeWhitespace(
    $('.gn-article-meta span')
      .map((_, el) => $(el).text())
      .get()
      .join(' ')
  );

  return {
    sourceUrl: articleUrl,
    title,
    content,
    imageUrls,
    publishedAt: publishedAt || undefined
  };
}

export async function fetchLatestGastroNewsArticle(sourceUrl: string): Promise<ArticleData> {
  const homepageHtml = await withRetry(
    async () => {
      const response = await axios.get<string>(sourceUrl, { timeout: 20_000 });
      return response.data;
    },
    { operationName: 'fetch_homepage' }
  );

  const articleUrl = extractLatestArticleUrl(homepageHtml, sourceUrl);

  const articleHtml = await withRetry(
    async () => {
      const response = await axios.get<string>(articleUrl, { timeout: 20_000 });
      return response.data;
    },
    { operationName: 'fetch_article' }
  );

  return extractArticleContent(articleHtml, articleUrl);
}
