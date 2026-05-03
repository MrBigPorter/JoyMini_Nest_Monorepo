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
- Groq free tier allows 30 requests per minute
- The system automatically handles rate limiting with cooldown and key rotation
- If you have multiple keys, they will be rotated automatically

### Translation quality issues
- Try switching to a different model (e.g., `llama-3.3-70b-versatile` for better quality)
- Check the AI Service Status card for provider-specific error messages
