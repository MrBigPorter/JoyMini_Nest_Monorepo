# Android App Links - assetlinks.json Configuration

## Summary
Add `assetlinks.json` to the frontend-blog project so that Android App `com.tarsier.labs` can handle `blog.joyminis.com` links directly (no browser chooser dialog).

## Background
- The frontend-blog (Next.js) is deployed at `blog.joyminis.com` via Cloudflare Workers
- iOS Universal Links already configured via `apps/frontend-blog/public/.well-known/apple-app-site-association`
- Android App Links need a separate `assetlinks.json` file in the same `.well-known/` directory

## How It Works
```
User clicks https://blog.joyminis.com/article/123
        │
        ▼
Android system intercepts the link
        │
        ▼
Checks AndroidManifest.xml for intent filter with host="blog.joyminis.com"
        │
        ▼
Validates by fetching https://blog.joyminis.com/.well-known/assetlinks.json
        │
        ▼
If SHA256 matches → opens App directly (no chooser dialog)
If no match → opens in browser
```

## Files to Create

### 1. `apps/frontend-blog/public/.well-known/assetlinks.json`
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.tarsier.labs",
      "sha256_cert_fingerprints": [
        "93:C0:D3:0B:5B:61:51:63:BA:C1:4C:45:36:80:09:CB:76:F3:74:5F:AA:2B:06:9B:EE:62:93:0D:79:6E:5D:97"
      ]
    }
  }
]
```

## Verification
- After deployment, verify: `curl https://blog.joyminis.com/.well-known/assetlinks.json`
- Use Google's official tester: https://developers.google.com/digital-asset-links/tools/generator
- Test on device: `adb shell am start -a android.intent.action.VIEW -d "https://blog.joyminis.com/article/test"`

## Android Side (React Native)
Also need to add intent filter in `AndroidManifest.xml`:
```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="blog.joyminis.com" />
</intent-filter>
```
