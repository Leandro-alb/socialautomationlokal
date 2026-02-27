import fs from 'node:fs';
import path from 'node:path';
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { withRetry } from '../core/retry';
import { logger } from '../core/logger';
import { AppError } from '../core/errors';
import type { Platform, UploadedMedia } from '../types/index';

interface PostizClientOptions {
  baseUrl: string;
  apiKey: string;
  publicUploadBaseUrl?: string;
}

type AuthMode = 'bearer' | 'raw';

const authHeaders = (apiKey: string, mode: AuthMode): Record<string, string> => ({
  Authorization: mode === 'bearer' ? `Bearer ${apiKey}` : apiKey
});

const tiktokDefaultSettings = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  duet: false,
  stitch: false,
  comment: true,
  autoAddMusic: 'yes',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  content_posting_method: 'UPLOAD'
};

const instagramDefaultSettings = {
  post_type: 'post'
};

export class PostizClient {
  private readonly api: AxiosInstance;
  private readonly apiKey: string;
  private readonly publicUploadBaseUrl?: string;
  private authMode: AuthMode | null = null;

  constructor(options: PostizClientOptions) {
    this.apiKey = options.apiKey;
    this.publicUploadBaseUrl = options.publicUploadBaseUrl?.replace(/\/+$/, '');
    this.api = axios.create({
      baseURL: options.baseUrl.replace(/\/+$/, ''),
      timeout: 30_000
    });
  }

  private rewriteUploadUrl(url: string): string {
    if (!this.publicUploadBaseUrl) {
      return url;
    }

    try {
      const parsed = new URL(url);
      return `${this.publicUploadBaseUrl}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  private async requestWithAuthFallback<T>(
    config: AxiosRequestConfig,
    retries = 3
  ): Promise<T> {
    const run = async (mode: AuthMode): Promise<T> => {
      const response = await this.api.request<T>({
        ...config,
        headers: {
          ...(config.headers ?? {}),
          ...authHeaders(this.apiKey, mode)
        }
      });
      return response.data;
    };

    if (this.authMode) {
      return withRetry(() => run(this.authMode as AuthMode), {
        attempts: retries,
        operationName: `${config.method || 'GET'} ${config.url} (${this.authMode})`
      });
    }

    try {
      const result = await withRetry(() => run('bearer'), {
        attempts: 1,
        operationName: `${config.method || 'GET'} ${config.url} (bearer)`
      });
      this.authMode = 'bearer';
      return result;
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      const responseData = (error as AxiosError)?.response?.data;
      const looksLikeAuthFailure = status === 401 || status === 403;

      if (!looksLikeAuthFailure) {
        throw error;
      }

      logger.warn(
        `Bearer auth rejected for ${config.url}. Falling back to raw API key auth. ${JSON.stringify(
          responseData
        )}`
      );

      const result = await withRetry(() => run('raw'), {
        attempts: retries,
        operationName: `${config.method || 'GET'} ${config.url} (raw)`
      });
      this.authMode = 'raw';
      return result;
    }
  }

  async healthCheck(): Promise<{ connected: boolean }> {
    return this.requestWithAuthFallback<{ connected: boolean }>({
      method: 'GET',
      url: '/public/v1/is-connected'
    });
  }

  async listIntegrations(): Promise<Array<{ id: string; identifier: string; name: string }>> {
    return this.requestWithAuthFallback<Array<{ id: string; identifier: string; name: string }>>({
      method: 'GET',
      url: '/public/v1/integrations'
    });
  }

  async uploadMedia(filePath: string): Promise<UploadedMedia> {
    if (!fs.existsSync(filePath)) {
      throw new AppError(`File not found: ${filePath}`, 'POSTIZ_FILE_NOT_FOUND');
    }

    const uploadWithMode = async (mode: AuthMode): Promise<UploadedMedia> => {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), path.basename(filePath));

      const response = await this.api.request<UploadedMedia>({
        method: 'POST',
        url: '/public/v1/upload',
        headers: {
          ...form.getHeaders(),
          ...authHeaders(this.apiKey, mode)
        },
        data: form,
        timeout: 120_000,
        maxBodyLength: Infinity
      });

      const data = response.data;
      if (data?.path) {
        data.path = this.rewriteUploadUrl(data.path);
      }
      return data;
    };

    if (this.authMode) {
      return withRetry(() => uploadWithMode(this.authMode as AuthMode), {
        attempts: 3,
        operationName: `POST /public/v1/upload (${this.authMode})`
      });
    }

    try {
      const res = await withRetry(() => uploadWithMode('bearer'), {
        attempts: 1,
        operationName: 'POST /public/v1/upload (bearer)'
      });
      this.authMode = 'bearer';
      return res;
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      const looksLikeAuthFailure = status === 401 || status === 403;

      if (!looksLikeAuthFailure) {
        throw error;
      }

      logger.warn('Bearer upload rejected. Falling back to raw API key auth.');
      const res = await withRetry(() => uploadWithMode('raw'), {
        attempts: 3,
        operationName: 'POST /public/v1/upload (raw)'
      });
      this.authMode = 'raw';
      return res;
    }
  }

  async createPostNow(input: {
    platform: Platform;
    integrationId: string;
    content: string;
    media: UploadedMedia[];
  }): Promise<unknown> {
    const { platform, integrationId, content, media } = input;

    const settings =
      platform === 'instagram' ? instagramDefaultSettings : tiktokDefaultSettings;

    const payload = {
      // Compatibility keys requested in spec.
      integrationId,
      content,
      mediaIds: media.map((m) => m.id),
      publishNow: true,

      // Actual Postiz public API payload.
      type: 'now',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: integrationId },
          value: [
            {
              content,
              image: media.map((m) => ({ id: m.id, path: m.path }))
            }
          ],
          settings
        }
      ]
    };

    return this.requestWithAuthFallback<unknown>({
      method: 'POST',
      url: '/public/v1/posts',
      data: payload
    });
  }
}
