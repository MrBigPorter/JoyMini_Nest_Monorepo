import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib/core";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as path from "path";
import * as fs from "fs";

export class S3R2SyncConstruct extends Construct {
  constructor(scope: Construct, id: string, _props?: cdk.StackProps) {
    super(scope, id);

    // 🔐 ACM SSL 证书（images.joyminis.com）
    const imageCert = new acm.Certificate(this, "ImageCertificate", {
      domainName: "images.joyminis.com",
      validation: acm.CertificateValidation.fromDns(),
    });

    // S3 Bucket — 图片存储
    const imageBucket = new s3.Bucket(this, "JoyMiniImagesBucket", {
      bucketName: "joymini-images-prod",
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
      ],
      cors: [
        {
          allowedOrigins: [
            "https://admin.joyminis.com",
            "https://blog-admin.joyminis.com",
            "https://blog.joyminis.com",
            "https://dev.joyminis.com",
          ],
          allowedMethods: [s3.HttpMethods.PUT],
          allowedHeaders: ["Content-Type"],
          exposedHeaders: ["ETag"],
          maxAge: 3600,
        },
      ],
    });

    // CloudFront Distribution — CDN
    const distribution = new cloudfront.Distribution(this, "JoyMiniImagesCdn", {
      defaultBehavior: {
        origin: new origins.S3Origin(imageBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: ["images.joyminis.com"],
      certificate: imageCert,
    });

    // Output
    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "CloudFront Domain (images.joyminis.com → this)",
    });

    // ============================================
    //  Secrets Manager — 存 R2 凭证
    // ============================================
    const r2Secret = new secretsmanager.Secret(this, "R2Credentials", {
      secretName: "joymini/r2-credentials",
      description: "Cloudflare R2 credentials for S3→R2 sync Lambda",
    });

    // ============================================
    //  SQS DLQ — 存同步失败的文件记录
    // ============================================
    const dlq = new sqs.Queue(this, "S3R2SyncDlq", {
      queueName: "s3-to-r2-sync-dlq",
      retentionPeriod: cdk.Duration.days(14), // 保留 14 天
    });

    // ============================================
    //  SNS Topic — 同步失败邮件通知
    // ============================================
    // 读取通知邮箱：优先 process.env（CI/CD），其次 .env.prod（本地）
    function getNotificationEmail(): string {
      const fromEnv = process.env.SYNC_NOTIFICATION_EMAIL;
      if (fromEnv) return fromEnv;
      try {
        const envContent = fs.readFileSync(
          path.resolve(__dirname, "../../../deploy/.env.prod"),
          "utf-8",
        );
        const match = envContent.match(/^SYNC_NOTIFICATION_EMAIL=(.+)$/m);
        if (match) return match[1].trim();
      } catch {}
      return "";
    }

    const notificationEmail = getNotificationEmail();

    let syncFailureTopic: sns.Topic | undefined;
    if (notificationEmail) {
      syncFailureTopic = new sns.Topic(this, "S3R2SyncFailureTopic", {
        topicName: "s3-to-r2-sync-failures",
        displayName: "S3-R2 Sync Failures",
      });

      syncFailureTopic.addSubscription(
        new subscriptions.EmailSubscription(notificationEmail),
      );
      console.log(`SNS topic created for: ${notificationEmail}`);
    } else {
      console.warn(
        "SYNC_NOTIFICATION_EMAIL not set — skipping SNS topic creation",
      );
    }

    // ============================================
    //  Lambda 函数 — S3 → R2 每日同步
    // ============================================
    const syncLambda = new lambdaNodejs.NodejsFunction(
      this,
      "S3ToR2SyncFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, "../../lambda/s3-to-r2-sync.ts"),
        handler: "handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 512,
        bundling: {
          externalModules: [
            "@aws-sdk/client-s3",
            "@aws-sdk/client-secrets-manager",
            "@aws-sdk/client-sns",
          ],
        },
        environment: {
          S3_BUCKET: imageBucket.bucketName,
          SECRET_NAME: r2Secret.secretName,
          DLQ_URL: dlq.queueUrl,
          SNS_TOPIC_ARN: syncFailureTopic?.topicArn || "",
        },
      },
    );

    // 授权：Lambda 可以读 S3 + 读 Secrets Manager + 写 SQS DLQ + 发 SNS
    imageBucket.grantRead(syncLambda);
    r2Secret.grantRead(syncLambda);
    dlq.grantSendMessages(syncLambda);
    syncFailureTopic?.grantPublish(syncLambda);

    // ============================================
    //  EventBridge 定时器 — 每天 3:00 AM UTC
    // ============================================
    new events.Rule(this, "DailyS3ToR2SyncRule", {
      ruleName: "daily-s3-to-r2-sync",
      description: "Daily sync S3 images to Cloudflare R2 backup",
      schedule: events.Schedule.cron({
        minute: "0",
        hour: "3",
      }),
      targets: [new targets.LambdaFunction(syncLambda)],
    });
  }
}
