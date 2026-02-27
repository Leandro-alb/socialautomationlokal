# GastroNews -> Postiz Automation (Node.js + TypeScript)

Production-ready manual pipeline that:
- Fetches latest article from `https://gastronews.org`
- Extracts title + full content + all article images
- Downloads images locally
- Dynamically builds slides (2 images -> 2 slides, 3 -> 3, ..., max 10)
- Generates Instagram/TikTok captions + dynamic hook lines via OpenAI
- Uploads media to Postiz
- Publishes immediately to Instagram/TikTok via Postiz Public API

## Project Structure

```txt
gastronews-postiz-pipeline/
  src/
    core/
      env.ts
      errors.ts
      logger.ts
      retry.ts
    llm/
      generateCopy.ts
    media/
      downloader.ts
      slides.ts
    postiz/
      client.ts
    scraper/
      gastronews.ts
    types/
      index.ts
    index.ts
  data/
    downloads/
    slides/
  .env.example
  package.json
  tsconfig.json
  README.md
```

## Setup

```bash
cd /Users/leandrobojani/gastronews-postiz-pipeline
cp .env.example .env
npm install
```

### macOS note for `node-canvas`
If install fails, run:

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman
npm install
```

## Run

Manual trigger only:

```bash
npx ts-node src/index.ts
```

Dry-run (no Postiz upload/publish):

```bash
npx ts-node src/index.ts --dry-run
```

## Postiz Integration Setup

1. Open Postiz UI (`http://localhost:5001` in your current setup).
2. Connect Instagram and TikTok in Integrations.
3. Copy integration IDs (or auto-detection by identifier is used).
4. Put IDs in `.env`:

```env
POSTIZ_INSTAGRAM_INTEGRATION_ID=<instagram_integration_id>
POSTIZ_TIKTOK_INTEGRATION_ID=<tiktok_integration_id>
```

## Postiz API Summary Used by This Project

Base URL:

```txt
http://127.0.0.1:5001/api
```

Endpoints used:
- `GET /public/v1/is-connected`
- `GET /public/v1/integrations`
- `POST /public/v1/upload`
- `POST /public/v1/posts`

Auth:
- Code tries `Authorization: Bearer <API_KEY>` first
- Falls back automatically to `Authorization: <API_KEY>` (required by current Postiz build)

## Example cURL (Postiz)

Health:

```bash
curl -sS 'http://127.0.0.1:5001/api/public/v1/is-connected' \
  -H 'Authorization: <API_KEY>'
```

List integrations:

```bash
curl -sS 'http://127.0.0.1:5001/api/public/v1/integrations' \
  -H 'Authorization: <API_KEY>'
```

Upload media:

```bash
curl -sS -X POST 'http://127.0.0.1:5001/api/public/v1/upload' \
  -H 'Authorization: <API_KEY>' \
  -F 'file=@./data/slides/example.jpg'
```

Create immediate post:

```bash
curl -sS -X POST 'http://127.0.0.1:5001/api/public/v1/posts' \
  -H 'Authorization: <API_KEY>' \
  -H 'Content-Type: application/json' \
  --data '{
    "type": "now",
    "shortLink": false,
    "date": "2026-02-26T19:45:00.000Z",
    "tags": [],
    "posts": [
      {
        "integration": {"id": "<integration_id>"},
        "value": [
          {
            "content": "Your caption",
            "image": [
              {"id": "<media_id_1>", "path": "<media_url_1>"},
              {"id": "<media_id_2>", "path": "<media_url_2>"}
            ]
          }
        ],
        "settings": {
          "privacy_level": "PUBLIC_TO_EVERYONE",
          "duet": false,
          "stitch": false,
          "comment": true,
          "autoAddMusic": "yes",
          "brand_content_toggle": false,
          "brand_organic_toggle": false,
          "content_posting_method": "UPLOAD"
        }
      }
    ]
  }'
```

## Health Checks

```bash
npm run typecheck
curl -sS 'http://127.0.0.1:5001/api/public/v1/is-connected' -H 'Authorization: <API_KEY>'
```

Runtime logs:
- Console output
- `logs/pipeline.log`

## Testing Instructions

1. Dry-run end-to-end:

```bash
npx ts-node src/index.ts --dry-run
```

2. Live run with one platform only:
- Set only one integration ID in `.env`
- Run:

```bash
npx ts-node src/index.ts
```

3. Confirm in Postiz UI that post is created and published immediately.

## Troubleshooting

- `Invalid API key`:
  - Verify `POSTIZ_API_KEY` in `.env`
  - Check Postiz token in organization settings
- `No target integrations found`:
  - Set integration IDs in `.env`
  - Or ensure integrations exist in Postiz (`/public/v1/integrations`)
- `node-canvas` build errors:
  - Install required brew libraries (see setup section)
- `OpenAI generation failed`:
  - Check `OPENAI_API_KEY`
  - Pipeline auto-falls back to generated local captions/hooks
- TikTok publish validation errors:
  - Ensure connected TikTok account supports selected posting method and privacy settings
