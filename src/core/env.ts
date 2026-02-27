import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().default('gpt-5.1'),

  // Your current Postiz setup is on 5001. You can still set 5000 if needed.
  POSTIZ_BASE_URL: z.string().url().default('http://127.0.0.1:5001/api'),
  POSTIZ_API_KEY: z.string().min(1, 'POSTIZ_API_KEY is required'),

  POSTIZ_INSTAGRAM_INTEGRATION_ID: z.string().optional(),
  POSTIZ_TIKTOK_INTEGRATION_ID: z.string().optional(),
  POSTIZ_PUBLIC_UPLOAD_BASE_URL: z.string().url().optional(),

  ARTICLE_SOURCE_URL: z.string().url().default('https://gastronews.org'),

  MAX_IMAGES: z.coerce.number().int().min(1).max(10).default(10),
  DRY_RUN: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true')
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  return envSchema.parse(process.env);
}
