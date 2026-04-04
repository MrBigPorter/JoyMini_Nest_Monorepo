import { FacebookProvider } from './facebook.provider';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

describe('FacebookProvider', () => {
  let configService: ConfigService;
  let jwtService: JwtService;

  beforeEach(() => {
    configService = new ConfigService({});
    jwtService = {
      decode: jest.fn(),
    } as unknown as JwtService;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('verifies facebook access token and maps profile', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'fb_user_1',
          email: 'demo@example.com',
          name: 'FB User',
          picture: { data: { url: 'https://img.example.com/fb-avatar.png' } },
        }),
    } as Response);

    const provider = new FacebookProvider(configService, jwtService);
    const profile = await provider.verify({
      accessToken: 'access-token',
      userId: 'fb_user_1',
    });

    expect(profile).toEqual({
      providerUserId: 'fb_user_1',
      email: 'demo@example.com',
      nickname: 'FB User',
      avatar: 'https://img.example.com/fb-avatar.png',
    });
  });

  it('verifies facebook ID token and maps profile', async () => {
    // Mock JWT decode for ID token
    (jwtService.decode as jest.Mock).mockReturnValue({
      sub: 'fb_user_2',
      email: 'idtoken@example.com',
      name: 'ID Token User',
      picture: 'https://img.example.com/id-avatar.png',
      aud: 'facebook-app-id',
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    });

    const provider = new FacebookProvider(
      new ConfigService({ FACEBOOK_APP_ID: 'facebook-app-id' }),
      jwtService,
    );

    // ID token is a JWT with 3 parts separated by dots
    const idToken = 'header.payload.signature';
    const profile = await provider.verify({
      accessToken: idToken,
      userId: 'fb_user_2',
    });

    expect(profile).toEqual({
      providerUserId: 'fb_user_2',
      email: 'idtoken@example.com',
      nickname: 'ID Token User',
      avatar: 'https://img.example.com/id-avatar.png',
    });
  });

  it('throws when user id mismatches for access token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'fb_user_2',
        }),
    } as Response);

    const provider = new FacebookProvider(configService, jwtService);

    await expect(
      provider.verify({
        accessToken: 'access-token',
        userId: 'fb_user_1',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when user id mismatches for ID token', async () => {
    (jwtService.decode as jest.Mock).mockReturnValue({
      sub: 'fb_user_2',
      aud: 'facebook-app-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const provider = new FacebookProvider(
      new ConfigService({ FACEBOOK_APP_ID: 'facebook-app-id' }),
      jwtService,
    );

    await expect(
      provider.verify({
        accessToken: 'header.payload.signature',
        userId: 'fb_user_1',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when ID token audience mismatches', async () => {
    (jwtService.decode as jest.Mock).mockReturnValue({
      sub: 'fb_user_2',
      aud: 'wrong-app-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const provider = new FacebookProvider(
      new ConfigService({ FACEBOOK_APP_ID: 'facebook-app-id' }),
      jwtService,
    );

    await expect(
      provider.verify({
        accessToken: 'header.payload.signature',
        userId: 'fb_user_2',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when ID token is expired', async () => {
    (jwtService.decode as jest.Mock).mockReturnValue({
      sub: 'fb_user_2',
      aud: 'facebook-app-id',
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
    });

    const provider = new FacebookProvider(
      new ConfigService({ FACEBOOK_APP_ID: 'facebook-app-id' }),
      jwtService,
    );

    await expect(
      provider.verify({
        accessToken: 'header.payload.signature',
        userId: 'fb_user_2',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('handles Graph API failure for access token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Invalid token'),
    } as Response);

    const provider = new FacebookProvider(configService, jwtService);

    await expect(
      provider.verify({
        accessToken: 'invalid-token',
        userId: 'fb_user_1',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
