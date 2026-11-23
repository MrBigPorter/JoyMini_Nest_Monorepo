import { GeminiProvider } from './gemini.provider';

const generateContent = jest.fn().mockResolvedValue({
  response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
});
const getGenerativeModel = jest.fn().mockReturnValue({ generateContent });

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest
    .fn()
    .mockImplementation(() => ({ getGenerativeModel })),
  GenerativeModel: class {},
  GenerationConfig: class {},
  HarmCategory: {
    HARM_CATEGORY_HATE_SPEECH: 'hate',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'danger',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'sexual',
    HARM_CATEGORY_HARASSMENT: 'harassment',
  },
  HarmBlockThreshold: { BLOCK_NONE: 'none' },
}));

const config = {
  get: (key: string) =>
    key === 'GOOGLE_GEMINI_API_KEY' ? 'test-key' : undefined,
} as any;

describe('GeminiProvider.generateText', () => {
  beforeEach(() => {
    getGenerativeModel.mockClear();
    generateContent.mockClear();
  });

  it('routes systemPrompt to systemInstruction instead of generationConfig', async () => {
    const provider = new GeminiProvider(config);

    await provider.generateText('hello', {
      temperature: 0.2,
      maxOutputTokens: 128,
      systemPrompt: 'be terse',
    });

    // 初始化时一次 + 本次带 systemPrompt 一次
    const call =
      getGenerativeModel.mock.calls[
        getGenerativeModel.mock.calls.length - 1
      ][0];
    expect(call.systemInstruction).toBe('be terse');
    expect(call.generationConfig).not.toHaveProperty('systemPrompt');

    const request =
      generateContent.mock.calls[generateContent.mock.calls.length - 1][0];
    expect(request.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 128,
    });
    expect(request.generationConfig).not.toHaveProperty('systemPrompt');
  });

  it('omits generationConfig when no valid option is provided', async () => {
    const provider = new GeminiProvider(config);

    await provider.generateText('hello', { systemPrompt: 'be terse' });

    const request =
      generateContent.mock.calls[generateContent.mock.calls.length - 1][0];
    expect(request).not.toHaveProperty('generationConfig');
  });
});
