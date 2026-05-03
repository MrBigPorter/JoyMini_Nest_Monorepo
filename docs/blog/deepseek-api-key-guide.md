# DeepSeek API Key Guide

## How to Get a DeepSeek API Key (Free)

1. Go to [DeepSeek Platform](https://platform.deepseek.com/)
2. Sign up for an account (email or Google login)
3. Navigate to **API Keys** section in the dashboard
4. Click **Create API Key**
5. Copy the key and add it to your environment configuration

## Environment Configuration

### Development (`deploy/.env.dev`)

```env
DEEPSEEK_API_KEY=sk-your_key_here
```

### Production (`deploy/.env.prod`)

```env
DEEPSEEK_API_KEY=sk-your_key_here
```

### Multiple Keys (Optional)

You can add multiple DeepSeek API keys separated by commas. The system will automatically rotate between keys when one is rate-limited or exhausted:

```env
DEEPSEEK_API_KEY=sk-key1,sk-key2,sk-key3
```

## DeepSeek Free Tier

| Tier | Limit | Duration |
|------|-------|----------|
| **Free Tokens** | 5,000,000 tokens | Permanent (one-time) |
| **Daily Limit** | 10,000,000 tokens/day | Per day |
| **Rate Limit** | 60 requests/minute | Per minute |

> **Note**: The 5M free tokens are a one-time grant upon registration, not a monthly allowance. Use them wisely for translation tasks.

## Available Models

| Model | Description | Best For |
|-------|-------------|----------|
| `deepseek-chat` | DeepSeek-V3, general purpose | Translation, content generation (default) |
| `deepseek-reasoner` | DeepSeek-R1, reasoning-focused | Complex analysis, logic tasks |

## Selecting a Model in the Admin UI

1. Go to **Blog → Translation Progress** in the admin panel
2. Find the **AI Provider Config** card
3. Select **DeepSeek** from the provider dropdown
4. Choose a model (`deepseek-chat` recommended for translation)
5. Click **Save**

The system will automatically use DeepSeek for all AI-powered translations.

## DeepSeek Strengths for Translation

- **Excellent Chinese↔English translation** — native Chinese model, understands nuances
- **Fast response times** — typically 1-3 seconds for short text
- **Large context window** — 64K tokens, can handle long articles
- **OpenAI-compatible API** — same format as Groq, easy to integrate

## Troubleshooting

### "Provider not available"
- Check that `DEEPSEEK_API_KEY` is set correctly in your `.env` file
- Verify the key hasn't expired in the DeepSeek dashboard
- Check if the daily token limit has been reached

### "Rate limit exceeded"
- The system automatically rotates to the next key if multiple keys are configured
- Wait 60 seconds for the cooldown to expire
- Consider adding more API keys for higher throughput

### Translation quality issues
- Try switching to `deepseek-reasoner` for more careful translations
- The default model `deepseek-chat` is optimized for speed and general quality
