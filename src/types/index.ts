export type Platform = 'instagram' | 'tiktok';

export interface ArticleData {
  sourceUrl: string;
  title: string;
  content: string;
  imageUrls: string[];
  publishedAt?: string;
}

export interface DownloadedImage {
  url: string;
  localPath: string;
}

export interface PlatformCopy {
  caption: string;
  hooks: string[];
}

export interface GeneratedCopy {
  instagram: PlatformCopy;
  tiktok: PlatformCopy;
}

export interface UploadedMedia {
  id: string;
  path: string;
  name?: string;
}

export interface PostResult {
  integrationId: string;
  response: unknown;
}
