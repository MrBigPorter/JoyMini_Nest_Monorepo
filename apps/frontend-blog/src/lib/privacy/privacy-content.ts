/**
 * Privacy policy content in all supported languages.
 * Uses a TypeScript constants file so markdown backticks and special
 * characters don't need escaping (unlike JSON-based i18n keys).
 *
 * Each entry is the full privacy policy document in markdown format,
 * suitable for rendering with react-markdown.
 */

export const PRIVACY_CONTENT: Record<string, string> = {
  en: `# Privacy Policy

**Last updated: May 2026**

## 1. Information We Collect

### 1.1 Information You Provide
- **Account Information**: When you register, we collect your email address, username, and profile picture (if provided).
- **Profile Data**: Your reading preferences, bookmarks, and content interactions.
- **Communications**: Any messages you send through our platform (e.g., comments on articles).

### 1.2 Information Collected Automatically
- **Usage Data**: Pages visited, time spent, features used, and interaction patterns.
- **Device Information**: Device type, operating system version, screen resolution, and unique device identifiers.
- **Log Data**: IP address, browser type, referring pages, and timestamps.

### 1.3 Cookies and Local Storage
We use local storage (MMKV) on your device to store:
- Authentication tokens and session data
- User preferences (theme, language, font size)
- Cached content for offline reading

## 2. How We Use Your Information

We use the collected information to:
- Provide, maintain, and improve our services
- Personalise your reading experience (theme, language, font size preferences)
- Send push notifications (with your permission) for new content and updates
- Analyse usage patterns to improve app performance and content relevance
- Ensure the security and integrity of our platform
- Comply with legal obligations

## 3. Data Sharing and Disclosure

We **do not sell** your personal information to third parties. We may share data with:

- **Service Providers**: Cloud hosting (AWS), analytics (Sentry for crash reporting), and push notification services. These providers are bound by data processing agreements.
- **Legal Requirements**: When required by law or to protect our rights and safety.
- **Aggregated Data**: Anonymised, non-personally identifiable data for analytics purposes.

## 4. Data Retention

We retain your data for as long as your account is active.

### 4.1 Clearing Your Activity Data

You can clear your activity data at any time from the app's Settings > Data > Clear All Data. This will:
- Delete your comments from articles (anonymised as "[deleted]" to preserve thread context)
- Remove all your bookmarks
- Remove all your likes
- Clear all cached data on your device (including authentication tokens, requiring re-login)

Your account itself will **not** be deleted — you can continue using the app after re-authenticating.

### 4.2 Account Deletion

If you delete your account:
- Your profile and personal data are permanently deleted within 30 days
- Anonymised content (e.g., public comments) may be retained
- Backup copies are purged within 90 days

## 5. Your Rights

Depending on your jurisdiction, you may have the right to:
- **Access**: Request a copy of your personal data
- **Rectification**: Correct inaccurate or incomplete data
- **Deletion**: Request deletion of your data ("Right to be Forgotten")
- **Portability**: Receive your data in a machine-readable format
- **Objection**: Object to processing of your data for marketing purposes
- **Withdraw Consent**: Withdraw consent at any time (does not affect lawfulness of prior processing)

To exercise these rights, contact us at **privacy@tarsierlabs.com**.

## 6. Third-Party Services

Our app integrates with the following third-party services:

| Service | Purpose | Data Shared |
|---------|---------|-------------|
| Sentry | Crash reporting & performance monitoring | Device info, app state, stack traces |
| AWS (CloudFront/S3) | Content delivery & image hosting | IP address, requested content |
| React Native MMKV | Local data storage | None (local only) |

## 7. Children's Privacy

Our services are not directed to individuals under the age of 13. We do not knowingly collect personal information from children. If we become aware that a child has provided us with personal data, we will take steps to delete it.

## 8. International Data Transfers

Your data may be transferred to and processed in countries other than your own. We ensure appropriate safeguards are in place through Standard Contractual Clauses and data processing agreements.

## 9. Security

We implement industry-standard security measures:
- Encryption in transit (TLS 1.3)
- Encrypted local storage for authentication tokens
- Regular security audits and penetration testing
- Access controls and authentication for API endpoints

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be notified via:
- In-app notification on next launch
- Email (if you have provided one)
- Updated "Last updated" date at the top of this page

## 11. Contact Us

If you have questions about this Privacy Policy, please contact us:

- **Email**: privacy@tarsierlabs.com
- **Address**: Tarsier Labs, Bohol, Philippines
- **In-App**: Settings → About Tarsier

---

*This Privacy Policy is compliant with GDPR, CCPA, and Apple App Store Guidelines as of May 2026.*`,

  zh: `# 隐私政策

**最后更新：2026年5月**

## 1. 我们收集的信息

### 1.1 您提供的信息
- **账户信息**：注册时，我们会收集您的电子邮件地址、用户名和头像（如提供）。
- **个人资料**：您的阅读偏好、书签和内容互动记录。
- **通讯内容**：您通过平台发送的任何消息（例如文章评论）。

### 1.2 自动收集的信息
- **使用数据**：访问的页面、停留时间、使用的功能以及互动模式。
- **设备信息**：设备类型、操作系统版本、屏幕分辨率和唯一设备标识符。
- **日志数据**：IP地址、浏览器类型、来源页面和时间戳。

### 1.3 Cookie和本地存储
我们在您的设备上使用本地存储（MMKV）来保存：
- 身份验证令牌和会话数据
- 用户偏好（主题、语言、字体大小）
- 离线阅读的缓存内容

## 2. 我们如何使用您的信息

我们将收集的信息用于：
- 提供、维护和改进我们的服务
- 个性化您的阅读体验（主题、语言、字体大小偏好）
- 在您允许的情况下发送推送通知，告知新内容和更新
- 分析使用模式以改进应用性能和内容相关性
- 确保我们平台的安全性和完整性
- 履行法律义务

## 3. 数据共享与披露

我们**不会**向第三方出售您的个人信息。我们可能在以下情况共享数据：

- **服务提供商**：云托管（AWS）、分析服务（Sentry用于崩溃报告）和推送通知服务。这些提供商受数据处理协议约束。
- **法律要求**：法律要求时，或为保护我们的权利和安全时。
- **汇总数据**：经过匿名化处理的、无法识别个人身份的数据，用于分析目的。

## 4. 数据保留

我们会在您的账户有效期间保留您的数据。

### 4.1 清除活动数据

您可以随时通过应用的 设置 > 数据 > 清除所有数据 来清除您的活动数据。此操作将：
- 删除您在文章中的评论（匿名化为"[已删除]"以保留对话上下文）
- 移除您的所有书签
- 移除您的所有点赞
- 清除设备上的所有缓存数据（包括身份验证令牌，需要重新登录）

您的账号**不会**被删除 — 重新认证后您可以继续使用应用。

### 4.2 账号删除

如果您删除账号：
- 您的个人资料和个人数据将在30天内永久删除
- 匿名化内容（如公开评论）可能会被保留
- 备份副本将在90天内清除

## 5. 您的权利

根据您所在的司法管辖区，您可能享有以下权利：
- **访问权**：请求获取您的个人数据副本
- **更正权**：更正不准确或不完整的数据
- **删除权**：请求删除您的数据（"被遗忘权"）
- **可携带权**：以机器可读格式接收您的数据
- **反对权**：反对为营销目的处理您的数据
- **撤回同意**：随时撤回同意（不影响此前处理的合法性）

如需行使这些权利，请通过 **privacy@tarsierlabs.com** 联系我们。

## 6. 第三方服务

我们的应用集成了以下第三方服务：

| 服务 | 用途 | 共享的数据 |
|---------|---------|-------------|
| Sentry | 崩溃报告与性能监控 | 设备信息、应用状态、堆栈跟踪 |
| AWS（CloudFront/S3） | 内容分发与图片托管 | IP地址、请求的内容 |
| React Native MMKV | 本地数据存储 | 无（仅本地存储） |

## 7. 儿童隐私

我们的服务不面向13岁以下的个人。我们不会故意收集儿童的个人信息。如果我们发现儿童向我们提供了个人数据，我们将采取措施予以删除。

## 8. 国际数据传输

您的数据可能会被传输到您所在国家以外的国家并进行处理。我们通过标准合同条款和数据处理协议确保适当的保护措施。

## 9. 安全措施

我们实施业界标准的安全措施：
- 传输加密（TLS 1.3）
- 身份验证令牌的加密本地存储
- 定期安全审计和渗透测试
- API端点的访问控制和身份验证

## 10. 本政策的变更

我们可能会不时更新本隐私政策。重大变更将通过以下方式通知：
- 下次启动时的应用内通知
- 电子邮件（如果您提供了邮箱）
- 更新本页面顶部的"最后更新"日期

## 11. 联系我们

如果您对本隐私政策有任何疑问，请联系我们：

- **电子邮件**：privacy@tarsierlabs.com
- **地址**：Tarsier Labs，菲律宾保和省
- **应用内**：设置 → 关于Tarsier

---

*本隐私政策符合GDPR、CCPA以及截至2026年5月的苹果App Store指南。*`,

  ja: `# プライバシーポリシー

**最終更新日：2026年5月**

## 1. 収集する情報

### 1.1 ユーザーが提供する情報
- **アカウント情報**：登録時に、メールアドレス、ユーザー名、プロフィール画像（提供の場合）を収集します。
- **プロフィールデータ**：読書設定、ブックマーク、コンテンツとのインタラクション。
- **通信内容**：プラットフォームを通じて送信されたメッセージ（記事へのコメントなど）。

### 1.2 自動的に収集される情報
- **使用状況データ**：訪問したページ、滞在時間、使用機能、操作パターン。
- **デバイス情報**：デバイスの種類、OSバージョン、画面解像度、固有のデバイス識別子。
- **ログデータ**：IPアドレス、ブラウザの種類、参照元ページ、タイムスタンプ。

### 1.3 Cookieとローカルストレージ
お客様のデバイス上のローカルストレージ（MMKV）を使用して以下を保存します：
- 認証トークンとセッションデータ
- ユーザー設定（テーマ、言語、フォントサイズ）
- オフライン読書用のキャッシュコンテンツ

## 2. 情報の利用目的

収集した情報は以下の目的で使用します：
- サービスの提供、維持、改善
- 読書体験のパーソナライズ（テーマ、言語、フォントサイズ設定）
- 新しいコンテンツやアップデートに関するプッシュ通知の送信（許可を得た場合）
- アプリのパフォーマンスとコンテンツの関連性を向上させるための使用パターンの分析
- プラットフォームのセキュリティと完全性の確保
- 法的義務の遵守

## 3. データの共有と開示

お客様の個人情報を第三者に**販売することはありません**。以下の場合にデータを共有する可能性があります：

- **サービスプロバイダー**：クラウドホスティング（AWS）、分析（Sentryによるクラッシュレポート）、プッシュ通知サービス。これらのプロバイダーはデータ処理契約に拘束されます。
- **法的要件**：法律で要求される場合、または当社の権利と安全を保護するため。
- **集計データ**：匿名化された個人を特定できないデータを分析目的で使用。

## 4. データの保持

アカウントがアクティブである限り、お客様のデータを保持します。アカウントを削除した場合：
- プロフィールと個人データは30日以内に完全に削除されます
- 匿名化されたコンテンツ（公開コメントなど）は保持される場合があります
- バックアップコピーは90日以内に消去されます

## 5. ユーザーの権利

お客様の居住地域に応じて、以下の権利を有する場合があります：
- **アクセス権**：個人データの写しを請求する権利
- **訂正権**：不正確または不完全なデータを訂正する権利
- **削除権**：データの削除を請求する権利（「忘れられる権利」）
- **データポータビリティ権**：機械可読形式でデータを受け取る権利
- **異議権**：マーケティング目的でのデータ処理に異議を唱える権利
- **同意の撤回**：いつでも同意を撤回する権利（それ以前の処理の合法性には影響しません）

これらの権利を行使するには、**privacy@tarsierlabs.com** までお問い合わせください。

## 6. 第三者サービス

本アプリは以下の第三者サービスと連携しています：

| サービス | 目的 | 共有されるデータ |
|---------|---------|-------------|
| Sentry | クラッシュレポートとパフォーマンス監視 | デバイス情報、アプリ状態、スタックトレース |
| AWS（CloudFront/S3） | コンテンツ配信と画像ホスティング | IPアドレス、要求されたコンテンツ |
| React Native MMKV | ローカルデータストレージ | なし（ローカルのみ） |

## 7. 子どものプライバシー

当社のサービスは13歳未満の個人を対象としていません。子どもから意図的に個人情報を収集することはありません。子どもが個人データを提供したことが判明した場合、削除する措置を講じます。

## 8. 国際データ転送

お客様のデータは、お客様の居住国以外の国に転送され、処理される場合があります。標準契約条項およびデータ処理契約を通じて適切な保護措置を確保しています。

## 9. セキュリティ

業界標準のセキュリティ対策を実施しています：
- 転送中の暗号化（TLS 1.3）
- 認証トークンの暗号化されたローカルストレージ
- 定期的なセキュリティ監査とペネトレーションテスト
- APIエンドポイントへのアクセス制御と認証

## 10. 本ポリシーの変更

本プライバシーポリシーは随時更新される場合があります。重要な変更は以下の方法で通知されます：
- 次回起動時のアプリ内通知
- メール（提供されている場合）
- このページ上部の「最終更新日」の更新

## 11. お問い合わせ

本プライバシーポリシーに関するご質問は、以下までお問い合わせください：

- **メール**：privacy@tarsierlabs.com
- **住所**：Tarsier Labs、フィリピン・ボホール州
- **アプリ内**：設定 → Tarsierについて

---

*本プライバシーポリシーは、2026年5月時点のGDPR、CCPA、Apple App Storeガイドラインに準拠しています。*`,

  ko: `# 개인정보처리방침

**최종 업데이트: 2026년 5월**

## 1. 수집하는 정보

### 1.1 사용자가 제공하는 정보
- **계정 정보**: 회원가입 시 이메일 주소, 사용자 이름, 프로필 사진(제공 시)을 수집합니다.
- **프로필 데이터**: 독서 기본 설정, 북마크, 콘텐츠 상호작용 기록.
- **커뮤니케이션**: 플랫폼을 통해 전송하는 모든 메시지(예: 기사 댓글).

### 1.2 자동으로 수집되는 정보
- **사용 데이터**: 방문한 페이지, 체류 시간, 사용한 기능, 상호작용 패턴.
- **기기 정보**: 기기 유형, 운영체제 버전, 화면 해상도, 고유 기기 식별자.
- **로그 데이터**: IP 주소, 브라우저 유형, 참조 페이지, 타임스탬프.

### 1.3 쿠키 및 로컬 저장소
당사는 사용자 기기의 로컬 저장소(MMKV)를 사용하여 다음을 저장합니다:
- 인증 토큰 및 세션 데이터
- 사용자 기본 설정(테마, 언어, 글꼴 크기)
- 오프라인 읽기를 위한 캐시된 콘텐츠

## 2. 정보의 사용 목적

수집된 정보는 다음 목적으로 사용됩니다:
- 서비스 제공, 유지 및 개선
- 독서 경험 개인화(테마, 언어, 글꼴 크기 설정)
- 새 콘텐츠 및 업데이트에 대한 푸시 알림 전송(사용자 허가 필요)
- 앱 성능 및 콘텐츠 관련성 향상을 위한 사용 패턴 분석
- 플랫폼의 보안 및 무결성 보장
- 법적 의무 준수

## 3. 데이터 공유 및 공개

당사는 사용자의 개인정보를 제3자에게 **판매하지 않습니다**. 다음과 같은 경우 데이터를 공유할 수 있습니다:

- **서비스 제공업체**: 클라우드 호스팅(AWS), 분석(Sentry 크래시 리포트), 푸시 알림 서비스. 이러한 제공업체는 데이터 처리 계약에 구속됩니다.
- **법적 요구사항**: 법률에서 요구하거나 당사의 권리와 안전을 보호하기 위해 필요한 경우.
- **집계 데이터**: 분석 목적으로 익명화된 개인 식별 불가능한 데이터.

## 4. 데이터 보관

사용자의 계정이 활성 상태인 동안 데이터를 보관합니다. 계정을 삭제할 경우:
- 프로필 및 개인 데이터는 30일 이내에 영구 삭제됩니다
- 익명화된 콘텐츠(예: 공개 댓글)는 보관될 수 있습니다
- 백업 복사본은 90일 이내에 제거됩니다

## 5. 사용자의 권리

관할권에 따라 다음 권리를 행사할 수 있습니다:
- **열람권**: 개인 데이터의 사본을 요청할 권리
- **정정권**: 부정확하거나 불완전한 데이터를 정정할 권리
- **삭제권**: 데이터 삭제를 요청할 권리("잊혀질 권리")
- **데이터 이동권**: 기계 판독 가능 형식으로 데이터를 받을 권리
- **반대권**: 마케팅 목적의 데이터 처리에 반대할 권리
- **동의 철회권**: 언제든지 동의를 철회할 권리(이전 처리의 적법성에는 영향 없음)

이러한 권리를 행사하려면 **privacy@tarsierlabs.com**으로 연락해 주십시오.

## 6. 제3자 서비스

본 앱은 다음과 같은 제3자 서비스와 통합됩니다:

| 서비스 | 목적 | 공유되는 데이터 |
|---------|---------|-------------|
| Sentry | 크래시 리포트 및 성능 모니터링 | 기기 정보, 앱 상태, 스택 트레이스 |
| AWS(CloudFront/S3) | 콘텐츠 전송 및 이미지 호스팅 | IP 주소, 요청된 콘텐츠 |
| React Native MMKV | 로컬 데이터 저장소 | 없음(로컬 전용) |

## 7. 아동의 개인정보 보호

당사의 서비스는 13세 미만의 개인을 대상으로 하지 않습니다. 아동으로부터 의도적으로 개인정보를 수집하지 않으며, 아동이 개인 데이터를 제공했음을 인지하는 경우 이를 삭제하기 위한 조치를 취합니다.

## 8. 국제 데이터 전송

사용자의 데이터는 사용자의 거주국 외 다른 국가로 전송되어 처리될 수 있습니다. 표준 계약 조항 및 데이터 처리 계약을 통해 적절한 보호 조치를 보장합니다.

## 9. 보안

업계 표준 보안 조치를 구현합니다:
- 전송 중 암호화(TLS 1.3)
- 인증 토큰의 암호화된 로컬 저장
- 정기적인 보안 감사 및 침투 테스트
- API 엔드포인트에 대한 접근 제어 및 인증

## 10. 본 방침의 변경

본 개인정보처리방침은 수시로 업데이트될 수 있습니다. 중요한 변경 사항은 다음을 통해 통지됩니다:
- 다음 실행 시 앱 내 알림
- 이메일(제공한 경우)
- 이 페이지 상단의 "최종 업데이트" 날짜 업데이트

## 11. 문의하기

본 개인정보처리방침에 관한 질문이 있으시면 다음으로 연락해 주십시오:

- **이메일**: privacy@tarsierlabs.com
- **주소**: Tarsier Labs, 필리핀 보홀주
- **앱 내**: 설정 → Tarsier 소개

---

*본 개인정보처리방침은 2026년 5월 기준 GDPR, CCPA 및 Apple App Store 가이드라인을 준수합니다.*`,

  fr: `# Politique de confidentialité

**Dernière mise à jour : Mai 2026**

## 1. Informations que nous collectons

### 1.1 Informations que vous fournissez
- **Informations de compte** : Lors de votre inscription, nous collectons votre adresse e-mail, votre nom d'utilisateur et votre photo de profil (si fournie).
- **Données de profil** : Vos préférences de lecture, favoris et interactions avec le contenu.
- **Communications** : Tout message que vous envoyez via notre plateforme (par exemple, commentaires sur les articles).

### 1.2 Informations collectées automatiquement
- **Données d'utilisation** : Pages visitées, temps passé, fonctionnalités utilisées et modèles d'interaction.
- **Informations sur l'appareil** : Type d'appareil, version du système d'exploitation, résolution d'écran et identifiants uniques de l'appareil.
- **Données de journal** : Adresse IP, type de navigateur, pages de référence et horodatages.

### 1.3 Cookies et stockage local
Nous utilisons le stockage local (MMKV) sur votre appareil pour conserver :
- Jetons d'authentification et données de session
- Préférences utilisateur (thème, langue, taille de police)
- Contenu mis en cache pour la lecture hors ligne

## 2. Utilisation de vos informations

Nous utilisons les informations collectées pour :
- Fournir, maintenir et améliorer nos services
- Personnaliser votre expérience de lecture (thème, langue, taille de police)
- Envoyer des notifications push (avec votre autorisation) pour les nouveaux contenus et mises à jour
- Analyser les modèles d'utilisation pour améliorer les performances de l'application et la pertinence du contenu
- Assurer la sécurité et l'intégrité de notre plateforme
- Respecter les obligations légales

## 3. Partage et divulgation des données

Nous **ne vendons pas** vos informations personnelles à des tiers. Nous pouvons partager des données avec :

- **Prestataires de services** : Hébergement cloud (AWS), analyses (Sentry pour le signalement des crashes) et services de notifications push. Ces prestataires sont liés par des accords de traitement des données.
- **Obligations légales** : Lorsque la loi l'exige ou pour protéger nos droits et notre sécurité.
- **Données agrégées** : Données anonymisées non identifiables à des fins d'analyse.

## 4. Conservation des données

Nous conservons vos données tant que votre compte est actif. Si vous supprimez votre compte :
- Votre profil et vos données personnelles sont définitivement supprimés dans les 30 jours
- Le contenu anonymisé (par exemple, les commentaires publics) peut être conservé
- Les copies de sauvegarde sont purgées dans les 90 jours

## 5. Vos droits

Selon votre juridiction, vous pouvez avoir le droit de :
- **Accès** : Demander une copie de vos données personnelles
- **Rectification** : Corriger des données inexactes ou incomplètes
- **Suppression** : Demander la suppression de vos données (« Droit à l'oubli »)
- **Portabilité** : Recevoir vos données dans un format lisible par machine
- **Opposition** : Vous opposer au traitement de vos données à des fins marketing
- **Retrait du consentement** : Retirer votre consentement à tout moment (sans affecter la légalité du traitement antérieur)

Pour exercer ces droits, contactez-nous à **privacy@tarsierlabs.com**.

## 6. Services tiers

Notre application intègre les services tiers suivants :

| Service | Objectif | Données partagées |
|---------|---------|-------------|
| Sentry | Signalement des crashes et surveillance des performances | Informations sur l'appareil, état de l'application, traces de pile |
| AWS (CloudFront/S3) | Distribution de contenu et hébergement d'images | Adresse IP, contenu demandé |
| React Native MMKV | Stockage local des données | Aucune (local uniquement) |

## 7. Confidentialité des enfants

Nos services ne sont pas destinés aux personnes de moins de 13 ans. Nous ne collectons pas sciemment d'informations personnelles auprès des enfants. Si nous avons connaissance qu'un enfant nous a fourni des données personnelles, nous prendrons des mesures pour les supprimer.

## 8. Transferts internationaux de données

Vos données peuvent être transférées et traitées dans des pays autres que le vôtre. Nous assurons des garanties appropriées via des clauses contractuelles types et des accords de traitement des données.

## 9. Sécurité

Nous mettons en œuvre des mesures de sécurité conformes aux standards de l'industrie :
- Chiffrement en transit (TLS 1.3)
- Stockage local chiffré pour les jetons d'authentification
- Audits de sécurité réguliers et tests d'intrusion
- Contrôles d'accès et authentification pour les points d'accès API

## 10. Modifications de cette politique

Nous pouvons mettre à jour cette politique de confidentialité de temps à autre. Les modifications importantes seront notifiées via :
- Notification dans l'application au prochain lancement
- E-mail (si vous en avez fourni un)
- Mise à jour de la date « Dernière mise à jour » en haut de cette page

## 11. Nous contacter

Si vous avez des questions concernant cette politique de confidentialité, veuillez nous contacter :

- **E-mail** : privacy@tarsierlabs.com
- **Adresse** : Tarsier Labs, Bohol, Philippines
- **Dans l'application** : Paramètres → À propos de Tarsier

---

*Cette politique de confidentialité est conforme au RGPD, au CCPA et aux directives de l'App Store d'Apple en date de mai 2026.*`,

  de: `# Datenschutzerklärung

**Stand: Mai 2026**

## 1. Welche Daten wir erfassen

### 1.1 Von Ihnen bereitgestellte Informationen
- **Kontoinformationen**: Bei der Registrierung erfassen wir Ihre E-Mail-Adresse, Ihren Benutzernamen und Ihr Profilbild (falls angegeben).
- **Profildaten**: Ihre Lesevoreinstellungen, Lesezeichen und Interaktionen mit Inhalten.
- **Kommunikation**: Nachrichten, die Sie über unsere Plattform senden (z. B. Kommentare zu Artikeln).

### 1.2 Automatisch erfasste Informationen
- **Nutzungsdaten**: Besuchte Seiten, Verweildauer, genutzte Funktionen und Interaktionsmuster.
- **Geräteinformationen**: Gerätetyp, Betriebssystemversion, Bildschirmauflösung und eindeutige Gerätekennungen.
- **Protokolldaten**: IP-Adresse, Browsertyp, Referrer-Seiten und Zeitstempel.

### 1.3 Cookies und lokaler Speicher
Wir verwenden lokalen Speicher (MMKV) auf Ihrem Gerät für:
- Authentifizierungstoken und Sitzungsdaten
- Benutzereinstellungen (Design, Sprache, Schriftgröße)
- Zwischengespeicherte Inhalte für das Lesen offline

## 2. Wie wir Ihre Daten verwenden

Wir verwenden die erfassten Informationen, um:
- Unsere Dienste bereitzustellen, zu warten und zu verbessern
- Ihr Leseerlebnis zu personalisieren (Design, Sprache, Schriftgröße)
- Push-Benachrichtigungen (mit Ihrer Erlaubnis) für neue Inhalte und Updates zu senden
- Nutzungsmuster zu analysieren, um die App-Leistung und Inhaltsrelevanz zu verbessern
- Die Sicherheit und Integrität unserer Plattform zu gewährleisten
- Gesetzliche Verpflichtungen zu erfüllen

## 3. Datenweitergabe und Offenlegung

Wir **verkaufen nicht** Ihre persönlichen Daten an Dritte. Wir können Daten weitergeben an:

- **Dienstleister**: Cloud-Hosting (AWS), Analyse (Sentry für Absturzberichte) und Push-Benachrichtigungsdienste. Diese Anbieter sind durch Datenverarbeitungsvereinbarungen gebunden.
- **Gesetzliche Anforderungen**: Wenn gesetzlich vorgeschrieben oder zum Schutz unserer Rechte und Sicherheit.
- **Aggregierte Daten**: Anonymisierte, nicht personenbezogene Daten für Analysezwecke.

## 4. Datenaufbewahrung

Wir bewahren Ihre Daten auf, solange Ihr Konto aktiv ist. Wenn Sie Ihr Konto löschen:
- Ihr Profil und Ihre persönlichen Daten werden innerhalb von 30 Tagen endgültig gelöscht
- Anonymisierte Inhalte (z. B. öffentliche Kommentare) können aufbewahrt werden
- Sicherungskopien werden innerhalb von 90 Tagen gelöscht

## 5. Ihre Rechte

Abhängig von Ihrem Gerichtsstand haben Sie möglicherweise das Recht auf:
- **Auskunft**: Anforderung einer Kopie Ihrer personenbezogenen Daten
- **Berichtigung**: Korrektur ungenauer oder unvollständiger Daten
- **Löschung**: Anforderung der Löschung Ihrer Daten („Recht auf Vergessenwerden")
- **Datenübertragbarkeit**: Erhalt Ihrer Daten in einem maschinenlesbaren Format
- **Widerspruch**: Widerspruch gegen die Verarbeitung Ihrer Daten zu Marketingzwecken
- **Widerruf der Einwilligung**: Jederzeitiger Widerruf der Einwilligung (die Rechtmäßigkeit der bisherigen Verarbeitung bleibt unberührt)

Zur Ausübung dieser Rechte kontaktieren Sie uns unter **privacy@tarsierlabs.com**.

## 6. Drittanbieterdienste

Unsere App integriert die folgenden Drittanbieterdienste:

| Dienst | Zweck | Geteilte Daten |
|---------|---------|-------------|
| Sentry | Absturzberichte und Leistungsüberwachung | Geräteinformationen, App-Status, Stack-Traces |
| AWS (CloudFront/S3) | Inhaltsbereitstellung und Bildhosting | IP-Adresse, angeforderte Inhalte |
| React Native MMKV | Lokale Datenspeicherung | Keine (nur lokal) |

## 7. Datenschutz von Kindern

Unsere Dienste richten sich nicht an Personen unter 13 Jahren. Wir erfassen nicht wissentlich personenbezogene Daten von Kindern. Falls wir feststellen, dass ein Kind uns personenbezogene Daten zur Verfügung gestellt hat, werden wir Maßnahmen zur Löschung ergreifen.

## 8. Internationale Datenübermittlung

Ihre Daten können in Länder außerhalb Ihres Wohnsitzlandes übermittelt und dort verarbeitet werden. Wir gewährleisten angemessene Schutzmaßnahmen durch Standardvertragsklauseln und Datenverarbeitungsvereinbarungen.

## 9. Sicherheit

Wir implementieren branchenübliche Sicherheitsmaßnahmen:
- Verschlüsselung während der Übertragung (TLS 1.3)
- Verschlüsselter lokaler Speicher für Authentifizierungstoken
- Regelmäßige Sicherheitsaudits und Penetrationstests
- Zugriffskontrollen und Authentifizierung für API-Endpunkte

## 10. Änderungen dieser Richtlinie

Wir können diese Datenschutzerklärung von Zeit zu Zeit aktualisieren. Wesentliche Änderungen werden mitgeteilt über:
- App-interne Benachrichtigung beim nächsten Start
- E-Mail (falls Sie eine angegeben haben)
- Aktualisiertes „Stand"-Datum oben auf dieser Seite

## 11. Kontakt

Bei Fragen zu dieser Datenschutzerklärung kontaktieren Sie uns bitte:

- **E-Mail**: privacy@tarsierlabs.com
- **Adresse**: Tarsier Labs, Bohol, Philippinen
- **In der App**: Einstellungen → Über Tarsier

---

*Diese Datenschutzerklärung entspricht der DSGVO, dem CCPA und den Apple App Store-Richtlinien, Stand Mai 2026.*`,
};

/**
 * Returns the privacy policy markdown content for the given locale.
 * Falls back to English for unsupported locales.
 */
export function getPrivacyPolicyContent(locale: string): string {
  const lang = locale.split('-')[0];
  return PRIVACY_CONTENT[lang] ?? PRIVACY_CONTENT.en;
}
