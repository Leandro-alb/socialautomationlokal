import OpenAI from 'openai';
import { z } from 'zod';
import { withRetry } from '../core/retry';
import { logger } from '../core/logger';
import type { ArticleData, GeneratedCopy } from '../types/index';

const copySchema = z.object({
  instagram: z.object({
    caption: z.string().min(1),
    hooks: z.array(z.string().min(1))
  }),
  tiktok: z.object({
    caption: z.string().min(1),
    hooks: z.array(z.string().min(1))
  })
});

const normalizeHooks = (hooks: string[], fallback: string, slideCount: number): string[] => {
  const base = hooks.filter(Boolean).slice(0, slideCount);
  while (base.length < slideCount) {
    base.push(base.length === 0 ? fallback : `${fallback} (${base.length + 1})`);
  }
  return base;
};

const buildFallback = (article: ArticleData, slideCount: number): GeneratedCopy => {
  const snippet = article.content.split('\n').filter(Boolean).slice(0, slideCount);
  const fallbackHooks = snippet.length > 0 ? snippet : [article.title];

  return {
    instagram: {
      caption:
        `${article.title}\n\n` +
        `${article.content.slice(0, 1200)}\n\n` +
        'Was ist deine Meinung dazu? Schreib es in die Kommentare.\n\n#GastroNews #Gastronomie #FoodBusiness',
      hooks: normalizeHooks(fallbackHooks, article.title, slideCount)
    },
    tiktok: {
      caption: `${article.title} | Jetzt Meinung droppen. #gastronews #gastro #tiktokgastro`,
      hooks: normalizeHooks(fallbackHooks, article.title, slideCount)
    }
  };
};

export async function generateCopyWithOpenAI(params: {
  apiKey: string;
  model: string;
  article: ArticleData;
  slideCount: number;
}): Promise<GeneratedCopy> {
  const { apiKey, model, article, slideCount } = params;

  const fallback = buildFallback(article, slideCount);
  const client = new OpenAI({ apiKey });

  const prompt = `You are a social media strategist for restaurant-industry content.
Return STRICT JSON only.

Task:
- Create Instagram and TikTok copy from this article.
- Hooks must be exactly ${slideCount} items each.
- Hooks are slide headlines, max 80 chars each.
- Instagram caption: structured, polished, clear CTA.
- TikTok caption: short, aggressive, punchy.

Output JSON shape:
{
  "instagram": {"caption": "string", "hooks": ["string"]},
  "tiktok": {"caption": "string", "hooks": ["string"]}
}

Article title:
${article.title}

Article content:
${article.content.slice(0, 9000)}
`;

  try {
    const response = await withRetry(
      async () =>
        client.chat.completions.create({
          model,
          temperature: 0.7,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Return valid JSON only. No markdown. No commentary. Do not include extra keys.'
            },
            { role: 'user', content: prompt }
          ]
        }),
      { operationName: 'openai_generate_copy', attempts: 2 }
    );

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      logger.warn('OpenAI returned empty content, using fallback copy');
      return fallback;
    }

    const parsed = copySchema.parse(JSON.parse(raw));

    return {
      instagram: {
        caption: parsed.instagram.caption,
        hooks: normalizeHooks(parsed.instagram.hooks, article.title, slideCount)
      },
      tiktok: {
        caption: parsed.tiktok.caption,
        hooks: normalizeHooks(parsed.tiktok.hooks, article.title, slideCount)
      }
    };
  } catch (error) {
    logger.warn(`OpenAI generation failed. Using fallback copy. ${(error as Error).message}`);
    return fallback;
  }
}
