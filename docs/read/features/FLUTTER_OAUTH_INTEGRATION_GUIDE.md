# Flutter Login Integration Guide (Firebase OAuth Unified Solution for All Platforms)

> **Core Objective**: Use Firebase Authentication to implement unified Google/Facebook/Apple login across all platforms, solving iOS H5 OAuth interception issues.  
> **Scope**: Flutter H5, Android App, iOS App + NestJS Backend  
> **Code First**: Based on actual implementation in `apps/api/src/client/auth/*.ts`.

---

## 0. This Update (2026-03-28)

### 🎯 Solution Change: From Native OAuth → Firebase Authentication

**Problem Background**:

- iOS H5 Google/Facebook login intercepted by WebView
- Native OAuth requires separate SDK integration for each platform, high maintenance cost

**Solution**:

- Introduce Firebase Authentication as unified authentication layer
- All three platforms (iOS/Android/H5) use the same Firebase SDK
- Backend adds `/api/v1/auth/firebase` unified endpoint
- Keep original `/oauth/*` endpoints as backup

**Core Advantages**:

- ✅ Solve iOS H5 OAuth interception issue
- ✅ Unified code across all platforms, 70% reduction in maintenance cost
- ✅ Firebase automatically handles token refresh
- ✅ Backend only needs one endpoint, simplified logic

---

## 1. Architecture Comparison

### 1.1 Original Solution (Separate Integration per Platform)

```
iOS App     ──→ Google SDK ──→ Backend /oauth/google
            ──→ Facebook SDK ──→ Backend /oauth/facebook
            ──→ Apple SDK ──→ Backend /oauth/apple

Android App ──→ Google SDK ──→ Backend /oauth/google
            ──→ Facebook SDK ──→ Backend /oauth/facebook

Web/H5      ──→ Google JS SDK ──→ Backend /oauth/google  ❌ Intercepted
            ──→ Facebook JS SDK ──→ Backend /oauth/facebook  ❌ Intercepted
```

**Problems**:

- Different SDKs per platform, code duplication
- iOS H5 WebView intercepts OAuth popups
- Decentralized token management, error-prone

### 1.2 Firebase Solution (Unified for All Platforms)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Firebase Authentication                        │
│                 (Unified Login Solution)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│   iOS App              Android App           Flutter H5          │
│   ┌─────────┐          ┌─────────┐          ┌─────────┐         │
│   │ Firebase │          │ Firebase │          │ Firebase │         │
│   │   SDK    │          │   SDK    │          │   SDK    │         │
│   └────┬────┘          └────┬────┘          └────┬────┘         │
│        │                    │                    │                │
│        └────────────────────┼────────────────────┘                │
│                             │                                     │
│                             ▼                                     │
│                    Firebase ID Token                              │
│                             │                                     │
│                             ▼                                     │
│              POST /api/v1/auth/firebase                           │
│                             │                                     │
│                             ▼                                     │
│                    Business JWT Token                             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Advantages**:

- All platforms use the same SDK and logic
- Firebase handles OAuth popups, avoiding interception
- Unified token management
- Backend only needs one endpoint

---

## 2. API Contract

### 2.1 Firebase Login Endpoint (New)

| Endpoint                | Method | Request Body               | Description                                    |
| ----------------------- | ------ | -------------------------- | ---------------------------------------------- |
| `/api/v1/auth/firebase` | POST   | `{ idToken, inviteCode? }` | Firebase unified login (Google/Facebook/Apple) |

**Request Body Example**:

```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ...",
  "inviteCode": "ABCD12"
}
```

**Response Example**:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "nickname": "User Name",
    "avatar": "https://...",
    "provider": "google"
  }
}
```

### 2.2 Keep Original Endpoints (Backup)

| Endpoint                      | Method | Request Body                           | Description                    |
| ----------------------------- | ------ | -------------------------------------- | ------------------------------ |
| `/api/v1/auth/oauth/google`   | POST   | `{ idToken, inviteCode? }`             | Native Google login (backup)   |
| `/api/v1/auth/oauth/facebook` | POST   | `{ accessToken, userId, inviteCode? }` | Native Facebook login (backup) |
| `/api/v1/auth/oauth/apple`    | POST   | `{ idToken, code?, inviteCode? }`      | Native Apple login (backup)    |

### 2.3 Session Endpoints (Unchanged)

| Endpoint               | Method | Request Body       | Description      |
| ---------------------- | ------ | ------------------ | ---------------- |
| `/api/v1/auth/refresh` | POST   | `{ refreshToken }` | Refresh token    |
| `/api/v1/auth/profile` | GET    | Bearer Token       | Get user profile |

### 2.4 Response Key Fields

- All successful logins return: `accessToken` + `refreshToken`
- `user.provider` returns actual login method: `google` / `facebook` / `apple`
- `user.email`, `user.nickname`, `user.avatar` parsed from Firebase token

---

## 3. Backend Implementation

### 3.1 Install Dependencies

```bash
cd apps/api
yarn add firebase-admin
```

### 3.2 Add Firebase Provider

```typescript
// apps/api/src/client/auth/providers/firebase.provider.ts

import { Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as admin from "firebase-admin";
import { VerifiedOauthProfile } from "./provider.types";

@Injectable()
export class FirebaseProvider {
  private readonly logger = new Logger(FirebaseProvider.name);

  constructor(private readonly configService: ConfigService) {
    // Initialize Firebase Admin SDK
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.configService.get("FIREBASE_PROJECT_ID"),
          clientEmail: this.configService.get("FIREBASE_CLIENT_EMAIL"),
          privateKey: this.configService
            .get("FIREBASE_PRIVATE_KEY")
            ?.replace(/\\n/g, "\n"),
        }),
      });
    }
  }

  async verifyIdToken(idToken: string): Promise<VerifiedOauthProfile> {
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);

      // Get provider info
      const provider = decodedToken.firebase?.sign_in_provider || "unknown";
      let providerName = "firebase";

      if (provider.includes("google.com")) {
        providerName = "google";
      } else if (provider.includes("facebook.com")) {
        providerName = "facebook";
      } else if (provider.includes("apple.com")) {
        providerName = "apple";
      }

      this.logger.debug(
        `Firebase token verified: ${decodedToken.uid}, provider: ${providerName}`,
      );

      return {
        providerUserId: decodedToken.uid,
        email: decodedToken.email || null,
        nickname:
          decodedToken.name || decodedToken.email?.split("@")[0] || null,
        avatar: decodedToken.picture || null,
        provider: providerName,
      };
    } catch (error) {
      this.logger.error(`Firebase token verification failed: ${error.message}`);
      throw new UnauthorizedException("Firebase token verification failed");
    }
  }
}
```

### 3.3 Add DTO

```typescript
// apps/api/src/client/auth/dto/firebase-login.dto.ts

import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class FirebaseLoginDto {
  @ApiProperty({ description: "Firebase ID Token" })
  @IsString()
  @IsNotEmpty()
  idToken: string;

  @ApiProperty({ description: "Invite code", required: false })
  @IsString()
  @IsOptional()
  inviteCode?: string;
}
```

### 3.4 Modify Controller

```typescript
// apps/api/src/client/auth/auth.controller.ts

import { FirebaseProvider } from "./providers/firebase.provider";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly googleProvider: GoogleProvider,
    private readonly facebookProvider: FacebookProvider,
    private readonly appleProvider: AppleProvider,
    private readonly firebaseProvider: FirebaseProvider, // New
  ) {}

  // ... Other endpoints remain unchanged ...

  @Post("firebase")
  @ApiOperation({ summary: "Firebase unified login (Google/Facebook/Apple)" })
  @Throttle({ otpRequest: { limit: 15, ttl: 60_000 } })
  @ApiOkResponse({ type: OauthLoginResponseDto })
  @HttpCode(HttpStatus.OK)
  async loginWithFirebase(
    @Body() dto: FirebaseLoginDto,
    @CurrentDevice() device: DeviceInfo,
  ) {
    const oauthProfile = await this.firebaseProvider.verifyIdToken(dto.idToken);
    return this.auth.loginWithOauth(oauthProfile.provider, oauthProfile, {
      ip: device.ip,
      ua: device.userAgent,
      inviteCode: dto.inviteCode,
    });
  }
}
```

### 3.5 Modify Module

```typescript
// apps/api/src/client/auth/auth.module.ts

import { FirebaseProvider } from "./providers/firebase.provider";

@Module({
  imports: [
    /* ... */
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleProvider,
    FacebookProvider,
    AppleProvider,
    FirebaseProvider, // New
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

### 3.6 Environment Variables Configuration

```bash
# deploy/.env.dev / deploy/.env.prod

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## 4. Flutter Implementation

### 4.1 Install Dependencies

**Option A: Pure Firebase (Recommended, Simplest)**

```yaml
# pubspec.yaml

dependencies:
  firebase_core: ^2.24.0
  firebase_auth: ^4.16.0
```

**Option B: Native SDK + Firebase (Better User Experience)**

```yaml
# pubspec.yaml

dependencies:
  firebase_core: ^2.24.0
  firebase_auth: ^4.16.0
  google_sign_in: ^6.2.1 # Optional: Better Google login UI
  flutter_facebook_auth: ^6.0.0 # Optional: Better Facebook login UI
  sign_in_with_apple: ^6.1.0 # Optional: Better Apple login UI
```

> **Recommendation**: Start with Option A (Pure Firebase). Upgrade to Option B if user experience is not satisfactory.

### 4.2 Firebase Initialization

```dart
// lib/core/services/firebase_service.dart

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';

class FirebaseService {
  static Future<void> initialize() async {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }

  static FirebaseAuth get auth => FirebaseAuth.instance;
}
```

### 4.3 Google Login

**Option A: Pure Firebase (Recommended)**

```dart
// lib/core/services/auth/google_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';

class GoogleSignInService {
  static Future<String?> signIn() async {
    try {
      // Pure Firebase: Use GoogleAuthProvider directly
      final GoogleAuthProvider googleProvider = GoogleAuthProvider();

      final userCredential =
          await FirebaseAuth.instance.signInWithPopup(googleProvider);

      // Get Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Google Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

**Option B: Native SDK + Firebase (Better UX)**

```dart
// lib/core/services/auth/google_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

class GoogleSignInService {
  static Future<String?> signIn() async {
    try {
      final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) return null;

      final GoogleSignInAuthentication googleAuth =
          await googleUser.authentication;

      final credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // Get Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Google Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await GoogleSignIn().signOut();
    await FirebaseAuth.instance.signOut();
  }
}
```

### 4.4 Facebook Login

**Option A: Pure Firebase (Recommended)**

```dart
// lib/core/services/auth/facebook_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';

class FacebookSignInService {
  static Future<String?> signIn() async {
    try {
      // Pure Firebase: Use FacebookAuthProvider directly
      final FacebookAuthProvider facebookProvider = FacebookAuthProvider();

      final userCredential =
          await FirebaseAuth.instance.signInWithPopup(facebookProvider);

      // Get Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Facebook Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

**Option B: Native SDK + Firebase (Better UX)**

```dart
// lib/core/services/auth/facebook_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_facebook_auth/flutter_facebook_auth.dart';

class FacebookSignInService {
  static Future<String?> signIn() async {
    try {
      final LoginResult result = await FacebookAuth.instance.login();
      if (result.status != LoginStatus.success) return null;

      final credential =
          FacebookAuthProvider.credential(result.accessToken!.token);

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // Get Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Facebook Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FacebookAuth.instance.logOut();
    await FirebaseAuth.instance.signOut();
  }
}
```

### 4.5 Apple Login

**Option A: Pure Firebase (Recommended)**

```dart
// lib/core/services/auth/apple_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';

class AppleSignInService {
  static Future<String?> signIn() async {
    try {
      // Pure Firebase: Use OAuthProvider('apple.com') directly
      final OAuthProvider appleProvider = OAuthProvider('apple.com');

      final userCredential =
          await FirebaseAuth.instance.signInWithPopup(appleProvider);

      // Get Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Apple Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

**Option B: Native SDK + Firebase (Better UX)**

```dart
// lib/core/services/auth/apple_sign_in_service.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

class AppleSignInService {
  static Future<String?> signIn() async {
    try {
      final appleCredential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.name,
        ],
      );

      final credential = OAuthProvider('apple.com').credential(
        idToken: appleCredential.identityToken,
      );

      final userCredential =
          await FirebaseAuth.instance.signInWithCredential(credential);

      // Get Firebase ID Token
      final idToken = await userCredential.user?.getIdToken();
      return idToken;
    } catch (e) {
      print('Apple Sign-In failed: $e');
      return null;
    }
  }

  static Future<void> signOut() async {
    await FirebaseAuth.instance.signOut();
  }
}
```

### 4.6 Unified Login API Call

```dart
// lib/core/api/auth_api.dart

import 'package:dio/dio.dart';

class AuthApi {
  final Dio _dio;

  AuthApi(this._dio);

  /// Firebase unified login
  Future<LoginResponse> firebaseLogin({
    required String idToken,
    String? inviteCode,
  }) async {
    final response = await _dio.post(
      '/api/v1/auth/firebase',
      data: {
        'idToken': idToken,
        if (inviteCode != null) 'inviteCode': inviteCode,
      },
    );
    return LoginResponse.fromJson(response.data);
  }
}
```

### 4.7 Login Page Example

```dart
// lib/app/page/login_page.dart

class LoginPage extends StatelessWidget {
  Future<void> _handleGoogleLogin(BuildContext context) async {
    final idToken = await GoogleSignInService.signIn();
    if (idToken == null) return;

    final api = context.read<AuthApi>();
    final response = await api.firebaseLogin(idToken: idToken);

    // Save tokens
    await TokenStorage.saveTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );

    // Navigate to home
    Navigator.pushReplacementNamed(context, '/home');
  }

  Future<void> _handleFacebookLogin(BuildContext context) async {
    final idToken = await FacebookSignInService.signIn();
    if (idToken == null) return;

    final api = context.read<AuthApi>();
    final response = await api.firebaseLogin(idToken: idToken);

    // Save tokens
    await TokenStorage.saveTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );

    // Navigate to home
    Navigator.pushReplacementNamed(context, '/home');
  }

  Future<void> _handleAppleLogin(BuildContext context) async {
    final idToken = await AppleSignInService.signIn();
    if (idToken == null) return;

    final api = context.read<AuthApi>();
    final response = await api.firebaseLogin(idToken: idToken);

    // Save tokens
    await TokenStorage.saveTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );

    // Navigate to home
    Navigator.pushReplacementNamed(context, '/home');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          ElevatedButton(
            onPressed: () => _handleGoogleLogin(context),
            child: Text('Google Login'),
          ),
          ElevatedButton(
            onPressed: () => _handleFacebookLogin(context),
            child: Text('Facebook Login'),
          ),
          ElevatedButton(
            onPressed: () => _handleAppleLogin(context),
            child: Text('Apple Login'),
          ),
        ],
      ),
    );
  }
}
```

---

## 5. Firebase Console Configuration

### 5.1 Create Firebase Project

1. Visit [Firebase Console](https://console.firebase.google.com/)
2. Create new project or use existing one
3. Select region: `asia-east1` or `asia-southeast1`

### 5.2 Enable Login Methods

```
Authentication → Sign-in method → Enable the following:
- Google ✅
- Facebook ✅
- Apple ✅
```

### 5.3 Add Applications

#### Flutter H5 (Web Application)

```
Project Settings → General → Your apps → Add Web app
- App nickname: lucky-h5
- Also set up Firebase Hosting: No

Get configuration:
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

#### Android Application

```
Project Settings → General → Your apps → Add Android app
- Android package name: com.yourcompany.lucky
- App nickname: lucky-android

Download config file: google-services.json
Location: android/app/google-services.json
```

#### iOS Application

```
Project Settings → General → Your apps → Add iOS app
- iOS Bundle ID: com.yourcompany.lucky
- App nickname: lucky-ios

Download config file: GoogleService-Info.plist
Location: ios/Runner/GoogleService-Info.plist
```

### 5.4 Configure OAuth Callback Domains

#### Google

```
APIs & Services → Credentials → OAuth 2.0 Client IDs
- Authorized JavaScript origins: https://your-domain.com
- Authorized redirect URIs: https://your-domain.com/__/auth/handler
```

#### Facebook

```
Facebook Developer Console → Settings → Basic
- App Domains: your-domain.com
- Website URL: https://your-domain.com

Facebook Login → Settings
- Valid OAuth Redirect URIs: https://your-project.firebaseapp.com/__/auth/handler
```

#### Apple

```
Apple Developer → Certificates, Identifiers & Profiles
- Configure Sign in with Apple
- Return URLs: https://your-project.firebaseapp.com/__/auth/handler
```

---

## 6. Platform Configuration Boundaries

### 6.1 What Should Be in Client

- ✅ Put: Firebase configuration (apiKey, appId, etc. public identifiers)
- ❌ Don't put: Firebase Admin SDK private key

### 6.2 What Should Be in Backend

- ✅ Put: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- ✅ Backend responsible for token verification and issuing business JWT

### 6.3 H5 Configuration

```dart
// lib/firebase_options.dart

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    // Web/H5 configuration
    return const FirebaseOptions(
      apiKey: 'AIzaSy...',
      appId: '1:123456789:web:abc123',
      messagingSenderId: '123456789',
      projectId: 'your-project',
      authDomain: 'your-project.firebaseapp.com',
    );
  }
}
```

### 6.4 Run Examples

```bash
cd /Volumes/MySSD/work/dev/flutter_happy_app

# Run H5
fvm flutter run -d chrome

# Run Android
fvm flutter run -d android

# Run iOS
fvm flutter run -d ios
```

---

## 7. Unified Login Flow Rules

1. Call Firebase SDK to get `idToken`
2. Call backend `/api/v1/auth/firebase` endpoint
3. Save `accessToken` + `refreshToken`
4. Fetch `/auth/profile`
5. Navigate to home page

> **Each login method must not have its own post-login logic**

---

## 8. Risks and Solutions

### 8.1 Firebase Initialization Failure

**Symptom**: `Firebase.initializeApp()` throws exception

**Causes**:

- Firebase configuration file missing or incorrect
- Network issues preventing Firebase connection

**Solution**:

- Check `firebase_options.dart` configuration
- Check network connection
- Add try-catch and prompt user

### 8.2 iOS H5 Still Intercepted

**Symptom**: Firebase login popup still intercepted

**Causes**:

- Browser disabled popups
- WebView security policy restrictions

**Solution**:

- Use `signInWithPopup` instead of `signInWithRedirect`
- Prompt user to allow popups
- Consider using deep links to open system browser

### 8.3 Token Verification Failure

**Symptom**: Backend returns 401 Unauthorized

**Causes**:

- Firebase Admin SDK configuration error
- Token expired or format incorrect

**Solution**:

- Check backend environment variables
- Confirm Firebase project ID matches
- Check backend logs for specific error

### 8.4 Facebook Login Failure

**Symptom**: Facebook authorization successful but backend verification fails

**Causes**:

- Facebook App ID mismatch
- OAuth callback domain not configured

**Solution**:

- Check Facebook Developer Console configuration
- Confirm callback domain is correct

---

## 9. Backend Debug Log Points

Check these files first:

1. `apps/api/src/client/auth/auth.controller.ts`: Whether `/firebase` route is hit
2. `apps/api/src/client/auth/providers/firebase.provider.ts`: Where token verification fails
3. `apps/api/src/client/auth/auth.service.ts`: Whether `loginWithOauth()` is called
4. `apps/api/src/main.ts`: Whether CORS whitelist loaded as expected

---

## 10. Integration Error Quick Reference

| Symptom                        | Common Cause                         | Action                                 |
| ------------------------------ | ------------------------------------ | -------------------------------------- |
| Firebase initialization failed | Config file missing or incorrect     | Check `firebase_options.dart`          |
| Google login 401               | Firebase project ID mismatch         | Align frontend/backend Firebase config |
| Facebook login failed          | OAuth callback domain not configured | Check Facebook Developer Console       |
| Apple login failed             | Return URL not configured            | Check Apple Developer configuration    |
| Token verification failed      | Firebase Admin SDK config error      | Check backend environment variables    |
| CORS blocked                   | `CORS_ORIGIN` missing current domain | Add domain to whitelist                |

---

## 11. Minimum Regression Test

```bash
cd /Volumes/MySSD/work/dev/flutter_happy_app
./tool/test_login_regression.sh
```

Key coverage:

- Firebase initialization
- Google/Facebook/Apple login flow
- Token save and refresh
- User info retrieval
- Post-login navigation

---

## 12. Migration Plan

### Phase 1: Backend Preparation (1 day)

- [ ] Install `firebase-admin` dependency
- [ ] Create `FirebaseProvider`
- [ ] Add `/auth/firebase` endpoint
- [ ] Configure environment variables
- [ ] Unit tests

### Phase 2: Flutter H5 First (1 day)

- [ ] Integrate Firebase JS SDK
- [ ] Implement Google login
- [ ] Implement Facebook login
- [ ] Implement Apple login
- [ ] Test iOS H5 interception issue resolution

### Phase 3: Flutter App Migration (2 days)

- [ ] Android Firebase SDK integration
- [ ] iOS Firebase SDK integration
- [ ] Unified login logic
- [ ] End-to-end testing

### Phase 4: Clean Up Old Code (Optional)

- [ ] Keep `/oauth/*` endpoints as backup
- [ ] Mark old endpoints as deprecated
- [ ] Update documentation

---

## 13. Documentation Maintenance Principles

- Keep only current actionable information, not historical design discussions
- When adding new login methods, only update this file and corresponding code
- Firebase solution is primary, native OAuth as backup

---

## 14. References

- [Firebase Authentication Documentation](https://firebase.google.com/docs/auth)
- [Flutter Firebase Plugin](https://firebase.flutter.dev/)
- [Google Sign-In Flutter](https://pub.dev/packages/google_sign_in)
- [Facebook Auth Flutter](https://pub.dev/packages/flutter_facebook_auth)
- [Sign in with Apple Flutter](https://pub.dev/packages/sign_in_with_apple)
