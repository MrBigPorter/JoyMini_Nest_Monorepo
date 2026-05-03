# Groq API Key Guide

## How to Get a Groq API Key (Free)

1. **Visit GroqCloud Console**: https://console.groq.com/
2. **Sign up / Log in**: Create an account using Google, GitHub, or email
3. **Navigate to API Keys**: Go to https://console.groq.com/keys
4. **Create API Key**: Click "Create API Key", give it a name (e.g., "JoyMini Translation")
5. **Copy the Key**: Copy the generated key immediately — it will not be shown again

## Add the Key to Your Environment

### Development (`deploy/.env.dev`)

```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```

### Production (`deploy/.env.prod`)

```env
GROQ_API_KEY=gsk_your_groq_api_key_here
```

### Multiple Keys (Optional)

You can provide multiple Groq API keys separated by commas for automatic key rotation:

```env
GROQ_API_KEY=gsk_key1,gsk_key2,gsk_key3
```

## Groq Free Tier Limits

| Limit | Value |
|-------|-------|
| Requests per minute (RPM) | 30 |
| Requests per day | 14,400 |
| Tokens per day | 500,000 |
| Concurrent requests | Varies by model |

> **⚠️ Important: All API keys share a single account-level rate limit.** Multiple keys do NOT multiply your total capacity. For example, 4 keys still means ~30 RPM total, not 120 RPM. The system's multi-key support is designed for RPM-aware smart selection (`selectBestKey()`) rather than capacity stacking. When one key hits a 429 rate limit, ALL keys are blocked simultaneously because they share the same account quota.

## Available Models

| Model | Context Window | Best For |
|-------|---------------|----------|
| `llama-3.3-70b-versatile` | 128K tokens | High-quality translation, handles long articles (recommended) |
| `llama3-70b-8192` | 8K tokens | Fast translation, short content |
| `llama-3.1-8b-instant` | 128K tokens | Lightweight, fast, good for simple translations |

## Selecting a Model in the Admin UI

1. Navigate to the **Translation Progress** page in the admin panel
2. Find the **"AI Provider Config"** card
3. Select **"Groq"** from the Provider dropdown
4. Select your preferred model from the Model dropdown
5. Click **"Save Config"**
6. The system will immediately start using Groq for all new translation jobs

## What Groq CANNOT Do

- **Image/OCR processing**: Groq does not support vision or image content generation. The system will automatically route image-related AI tasks to Gemini.
- **Content moderation**: Comment moderation and auto-reply features still use Gemini.
- **Embedding generation**: Text embeddings for search features remain Gemini-only.

## Troubleshooting

### "Provider not available"
- Check that `GROQ_API_KEY` is set in your environment
- Verify the API key is valid in the GroqCloud console
- Restart the API server after adding the key

### "Rate limit exceeded"
- Groq free tier allows ~30 requests per minute per account (all keys share this limit)
- The system tracks per-key RPM using a **rolling 60-second window** and proactively selects the least-loaded key via `selectBestKey()`
- When rate limiting occurs (HTTP 429), the system reads the **`Retry-After` header** and blocks **ALL keys** for the duration specified
- Multiple keys do **NOT** multiply your rate limit — they share the same account-level quota
- If all Groq keys are blocked, try switching the AI provider to **Gemini** or **DeepSeek** via the Admin UI

### Translation quality issues
- Try switching to a different model (e.g., `llama-3.3-70b-versatile` for better quality)
- Check the AI Service Status card for provider-specific error messages

### Rate Limit Recovery (Retry-After header)
When Groq returns a 429 (Too Many Requests) response, it may include a `Retry-After` header specifying the number of seconds to wait before retrying. The system respects this header precisely:

- All keys are blocked immediately for the duration indicated in `Retry-After`
- The cooldown can be as short as **60 seconds** or as long as **8400 seconds (~2.3 hours)** depending on violation severity
- The `unblockExpiredKeys()` method runs every second and automatically unblocks keys when the cooldown expires
- Until cooldown expires, all Groq translation requests will fail — the server will **not** retry aggressively (prevents retry storm that would reset the rate limit clock)
- **Recommendation:** If Groq is blocked for an extended period, switch to Gemini or DeepSeek via the Admin UI (**Translation Progress** page → **AI Provider Config** card)
