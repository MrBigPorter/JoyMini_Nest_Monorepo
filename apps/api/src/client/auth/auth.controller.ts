import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginOtpDto, LoginResultResponseDto } from './dto/login.dto';
import { Throttle } from '@nestjs/throttler';
import { CurrentUserId } from '@api/common/decorators/user.decorator';
import { RefreshTokenDto } from '@api/client/auth/dto/refresh-token.dto';
import { TokenResponseDto } from '@api/client/auth/dto/token-response.dto';
import { JwtAuthGuard } from '@api/common/jwt/jwt.guard';
import { UserProfileResponseDto } from '@api/client/auth/dto/user-profile.response.dto';
import {
  CurrentDevice,
  DeviceInfo,
} from '@api/common/decorators/http.decorators';
import {
  AppleOauthLoginDto,
  FacebookOauthLoginDto,
  GoogleOauthLoginDto,
} from '@api/client/auth/dto/oauth-login.dto';
import { OauthLoginResponseDto } from '@api/client/auth/dto/oauth-login.response.dto';
import {
  EmailLoginDto,
  SendEmailCodeDto,
  SendEmailCodeResponseDto,
} from '@api/client/auth/dto/email-login.dto';
import { GoogleProvider } from '@api/client/auth/providers/google.provider';
import { FacebookProvider } from '@api/client/auth/providers/facebook.provider';
import { AppleProvider } from '@api/client/auth/providers/apple.provider';
import { FirebaseProvider } from '@api/client/auth/providers/firebase.provider';
import { FirebaseLoginDto } from '@api/client/auth/dto/firebase-login.dto';

//@ApiTags('auth') Swagger 里把这些接口归到 auth 组。
//@Controller('auth')：这组接口的前缀是 /auth/*。
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly googleProvider: GoogleProvider,
    private readonly facebookProvider: FacebookProvider,
    private readonly appleProvider: AppleProvider,
    private readonly firebaseProvider: FirebaseProvider,
  ) {}

  // 使用手机号登陆
  @Post('login/otp')
  @ApiOperation({ summary: 'login with OTP' })
  @Throttle({ otpRequest: { limit: 20, ttl: 60_000 } })
  @ApiOkResponse({ type: LoginResultResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithOtp(
    @Body() dto: LoginOtpDto,
    @CurrentDevice() device: DeviceInfo,
    @Req()
    req: { headers: Record<string, string | string[] | undefined> },
  ) {
    const rawCountryCode = req.headers['x-country-code'];
    const countryCodeValue = Array.isArray(rawCountryCode)
      ? rawCountryCode[0]
      : rawCountryCode;
    const countryCode = countryCodeValue ? Number(countryCodeValue) : undefined;

    return await this.auth.loginWithOtp(dto.phone, {
      ip: device.ip,
      ua: device.userAgent,
      countryCode: Number.isFinite(countryCode) ? countryCode : undefined,
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refreshToken(dto.refreshToken);
  }

  // 获取用户信息
  //@ApiBearerAuth()：告诉 Swagger 这个接口需要 Bearer 鉴权，文档页会出现“Authorize”按钮
  //启用 JWT 守卫（自动从 Authorization: Bearer <token> 取 token、验签、验过期）。
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiOkResponse({ type: UserProfileResponseDto })
  async profile(@CurrentUserId() userId: string) {
    return this.auth.profile(userId);
  }

  @Post('oauth/google')
  @ApiOperation({ summary: 'login with Google OAuth' })
  @Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })
  @ApiOkResponse({ type: OauthLoginResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithGoogleOauth(
    @Body() dto: GoogleOauthLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    const idToken = dto.idToken ?? dto.credential;
    if (!idToken) {
      throw new BadRequestException('idToken or credential is required');
    }

    const oauthProfile = await this.googleProvider.verify(idToken);
    return this.auth.loginWithOauth('google', oauthProfile, {
      ip: device.ip,
      ua: device.userAgent,
      inviteCode: dto.inviteCode,
    });
  }

  @Post('oauth/facebook')
  @ApiOperation({ summary: 'login with Facebook OAuth' })
  @Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })
  @ApiOkResponse({ type: OauthLoginResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithFacebookOauth(
    @Body() dto: FacebookOauthLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    const userId = dto.userId ?? dto.userID;
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const oauthProfile = await this.facebookProvider.verify({
      accessToken: dto.accessToken,
      userId,
    });
    return this.auth.loginWithOauth('facebook', oauthProfile, {
      ip: device.ip,
      ua: device.userAgent,
      inviteCode: dto.inviteCode,
    });
  }

  @Post('oauth/apple')
  @ApiOperation({ summary: 'login with Apple OAuth' })
  @Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })
  @ApiOkResponse({ type: OauthLoginResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithAppleOauth(
    @Body() dto: AppleOauthLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    const oauthProfile = await this.appleProvider.verify(dto.idToken);
    return this.auth.loginWithOauth('apple', oauthProfile, {
      ip: device.ip,
      ua: device.userAgent,
      inviteCode: dto.inviteCode,
    });
  }

  @Post('email/send-code')
  @ApiOperation({ summary: 'send email otp code for login' })
  @Throttle({ otpRequest: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({ type: SendEmailCodeResponseDto })
  @HttpCode(HttpStatus.OK)
  async sendEmailCode(
    @Body() dto: SendEmailCodeDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    return this.auth.sendEmailLoginCode(dto.email, {
      ip: device.ip,
    });
  }

  @Post('email/login')
  @ApiOperation({ summary: 'login with email otp code' })
  @Throttle({ otpRequest: { limit: 20, ttl: 60_000 } })
  @ApiOkResponse({ type: LoginResultResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithEmailCode(
    @Body() dto: EmailLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    return this.auth.loginWithEmailCode(dto.email, dto.code, {
      ip: device.ip,
      ua: device.userAgent,
    });
  }

  @Post('firebase')
  @ApiOperation({ summary: 'Firebase unified login (Google/Facebook/Apple)' })
  @Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })
  @ApiOkResponse({ type: OauthLoginResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithFirebase(
    @Body() dto: FirebaseLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    const result = await this.firebaseProvider.verifyIdToken(dto.idToken);
    return this.auth.loginWithOauth(result.provider, result.profile, {
      ip: device.ip,
      ua: device.userAgent,
      inviteCode: dto.inviteCode,
    });
  }
}
