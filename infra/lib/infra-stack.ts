import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
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
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as rds from "aws-cdk-lib/aws-rds";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
// import * as route53 from "aws-cdk-lib/aws-route53";
// import * as route53Targets from "aws-cdk-lib/aws-route53-targets";

export class InfraStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 🧱 VPC — 你的 AWS 网络地盘
    this.vpc = new ec2.Vpc(this, "TarsierLabsVpc", {
      maxAzs: 2,
      natGateways: 0,
    });

    // ============================================
    //  ECS 前端（ECR + ECS + ALB + Fargate Service + Auto Scaling）
    // ============================================

    // 📦 ECR — Docker 镜像仓库
    const repository = new ecr.Repository(this, "TarsierLabsEcrRepo", {
      repositoryName: "tarsier-labs",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // 🚢 ECS Cluster
    const cluster = new ecs.Cluster(this, "TarsierLabsCluster", {
      vpc: this.vpc,
      clusterName: "tarsier-labs-cluster",
    });

    // 🔒 ALB Security Group
    const albSg = new ec2.SecurityGroup(this, "TarsierLabsAlbSg", {
      vpc: this.vpc,
      description: "Allow HTTP access to ALB",
      allowAllOutbound: true,
    });

    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP from anywhere",
    );
    albSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "Allow HTTPS from anywhere",
    );

    // 🔒 ECS Security Group
    const ecsSg = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: this.vpc,
      description: "Allow traffic from ALB to ECS",
      allowAllOutbound: true,
    });
    ecsSg.connections.allowFrom(albSg, ec2.Port.tcp(3000), "Allow frontend-blog + API from ALB");
    ecsSg.connections.allowFrom(albSg, ec2.Port.tcp(3001), "Allow admin-next from ALB");
    ecsSg.connections.allowFrom(albSg, ec2.Port.tcp(3002), "Allow admin-blog from ALB");

    // 🌐 ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "TarsierLabsAlb", {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: "tarsier-labs-alb",
    });

    // 🔐 ACM SSL 证书（tarsier.joyminis.com）
    const tarsierCert = new acm.Certificate(this, "TarsierCertificate", {
      domainName: "tarsier.joyminis.com",
      validation: acm.CertificateValidation.fromDns(),
    });

    // HTTP:80 → 重定向到 HTTPS
    const httpListener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });
    httpListener.addAction("RedirectToHttps", {
      action: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    // HTTPS:443 → 转发到 ECS
    const httpsListener = alb.addListener("HttpsListener", {
      port: 443,
      open: true,
      certificates: [tarsierCert],
    });

    // 📋 Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, "TarsierLabsTaskDef", {
      memoryLimitMiB: 2048,
      cpu: 1024,
      family: "tarsier-labs-task",
    });

    // 📦 Container
    const container = taskDef.addContainer("FrontendBlog", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      containerName: "frontend-blog",
      memoryLimitMiB: 2048,
      cpu: 1024,
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "frontend-blog" }),
    });
    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // 🚀 Fargate Service
    const service = new ecs.FargateService(this, "TarsierLabsService", {
      cluster,
      taskDefinition: taskDef,
      serviceName: "tarsier-labs-service",
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
      desiredCount: 1,
      enableExecuteCommand: true,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });

    // Auto Scaling — CPU > 70% 自动扩容
    const scaling = service.autoScaleTaskCount({
      maxCapacity: 3,
      minCapacity: 1,
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
    });

    // CloudWatch 告警 — CPU > 80% 触发
    new cloudwatch.Alarm(this, "CpuHighAlarm", {
      metric: service.metricCpuUtilization(),
      alarmName: "tarsier-labs-cpu-high",
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 1,
    });

    // 🎯 显式 Target Group — frontend-blog
    const frontendTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "FrontendBlogTG",
      {
        vpc: this.vpc,
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [service],
        healthCheck: {
          path: "/zh/",
          interval: cdk.Duration.seconds(30),
        },
      },
    );

    // 🔀 默认路由: 无匹配路径 → frontend-blog (不设 priority/conditions = 默认动作)
    httpsListener.addAction("DefaultFrontendBlog", {
      action: elbv2.ListenerAction.forward([frontendTargetGroup]),
    });

    // Output
    new cdk.CfnOutput(this, "AlbDnsUrl", {
      value: alb.loadBalancerDnsName,
      description: "ALB Visit URL",
    });

    // #####################################################################
    //  🆕 新服务 1: API Backend (NestJS, 根 Dockerfile.prod, port 3000)
    // #####################################################################

    const apiTaskDef = new ecs.FargateTaskDefinition(
      this,
      "ApiBackendTaskDef",
      {
        memoryLimitMiB: 512,
        cpu: 256,
        family: "api-backend-task",
      },
    );

    const apiContainer = apiTaskDef.addContainer("ApiBackend", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "backend-latest"),
      containerName: "api-backend",
      memoryLimitMiB: 512,
      cpu: 256,
      environment: {
        NODE_ENV: "production",
        PORT: "3000",
        DATABASE_URL: "postgresql://postgres@localhost:5432/joymini",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api-backend" }),
    });
    apiContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    const apiService = new ecs.FargateService(this, "ApiBackendService", {
      cluster,
      taskDefinition: apiTaskDef,
      serviceName: "api-backend-service",
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
      desiredCount: 1,
      enableExecuteCommand: true,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });

    // Auto Scaling
    const apiScaling = apiService.autoScaleTaskCount({
      maxCapacity: 2,
      minCapacity: 1,
    });
    apiScaling.scaleOnCpuUtilization("ApiCpuScaling", {
      targetUtilizationPercent: 70,
    });

    const apiTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "ApiBackendTG",
      {
        vpc: this.vpc,
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [apiService],
        healthCheck: {
          path: "/api/v1/health",
          interval: cdk.Duration.seconds(30),
          healthyHttpCodes: "200",
        },
      },
    );

    // #####################################################################
    //  🆕 新服务 2: admin-next (Next.js, port 3001)
    // #####################################################################

    const adminNextTaskDef = new ecs.FargateTaskDefinition(
      this,
      "AdminNextTaskDef",
      {
        memoryLimitMiB: 1024,
        cpu: 512,
        family: "admin-next-task",
      },
    );

    const adminNextContainer = adminNextTaskDef.addContainer("AdminNext", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "admin-next-latest"),
      containerName: "admin-next",
      memoryLimitMiB: 1024,
      cpu: 512,
      environment: {
        NODE_ENV: "production",
        PORT: "3001",
        HOSTNAME: "0.0.0.0",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "admin-next" }),
    });
    adminNextContainer.addPortMappings({
      containerPort: 3001,
      protocol: ecs.Protocol.TCP,
    });

    const adminNextService = new ecs.FargateService(this, "AdminNextService", {
      cluster,
      taskDefinition: adminNextTaskDef,
      serviceName: "admin-next-service",
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
      desiredCount: 1,
      enableExecuteCommand: true,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });

    // Auto Scaling
    const adminNextScaling = adminNextService.autoScaleTaskCount({
      maxCapacity: 2,
      minCapacity: 1,
    });
    adminNextScaling.scaleOnCpuUtilization("AdminNextCpuScaling", {
      targetUtilizationPercent: 70,
    });

    const adminNextTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "AdminNextTG",
      {
        vpc: this.vpc,
        port: 3001,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [adminNextService],
        healthCheck: {
          path: "/en/admin/login",
          interval: cdk.Duration.seconds(30),
        },
      },
    );

    // #####################################################################
    //  🆕 新服务 3: admin-blog (Next.js, port 3002)
    // #####################################################################

    const adminBlogTaskDef = new ecs.FargateTaskDefinition(
      this,
      "AdminBlogTaskDef",
      {
        memoryLimitMiB: 1024,
        cpu: 512,
        family: "admin-blog-task",
      },
    );

    const adminBlogContainer = adminBlogTaskDef.addContainer("AdminBlog", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "admin-blog-latest"),
      containerName: "admin-blog",
      memoryLimitMiB: 1024,
      cpu: 512,
      environment: {
        NODE_ENV: "production",
        PORT: "3002",
        HOSTNAME: "0.0.0.0",
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "admin-blog" }),
    });
    adminBlogContainer.addPortMappings({
      containerPort: 3002,
      protocol: ecs.Protocol.TCP,
    });

    const adminBlogService = new ecs.FargateService(this, "AdminBlogService", {
      cluster,
      taskDefinition: adminBlogTaskDef,
      serviceName: "admin-blog-service",
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
      desiredCount: 1,
      enableExecuteCommand: true,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });

    // Auto Scaling
    const adminBlogScaling = adminBlogService.autoScaleTaskCount({
      maxCapacity: 2,
      minCapacity: 1,
    });
    adminBlogScaling.scaleOnCpuUtilization("AdminBlogCpuScaling", {
      targetUtilizationPercent: 70,
    });

    const adminBlogTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "AdminBlogTG",
      {
        vpc: this.vpc,
        port: 3002,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [adminBlogService],
        healthCheck: {
          path: "/en/admin/blogs",
          interval: cdk.Duration.seconds(30),
        },
      },
    );

    // 🔀 路径路由规则 (priority 越低越优先匹配)
    // /api/* → API backend
    httpsListener.addAction("ApiBackendRule", {
      action: elbv2.ListenerAction.forward([apiTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/*"])],
      priority: 10,
    });
    // /admin/* → admin-next
    httpsListener.addAction("AdminNextRule", {
      action: elbv2.ListenerAction.forward([adminNextTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(["/admin/*"])],
      priority: 20,
    });
    // /blog-admin/* → admin-blog
    httpsListener.addAction("AdminBlogRule", {
      action: elbv2.ListenerAction.forward([adminBlogTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(["/blog-admin/*"])],
      priority: 30,
    });

    // ============================================
    //  S3 → R2 多云同步
    // ============================================

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
            "https://admin.tarsierlabs.app",
            "https://tarsierlabs.app",
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
        origin: origins.S3BucketOrigin.withOriginAccessControl(imageBucket),
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
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS 主队列 — 接收 S3 实时事件
    const syncQueue = new sqs.Queue(this, "S3R2SyncQueue", {
      queueName: "s3-to-r2-sync-queue",
      visibilityTimeout: cdk.Duration.minutes(16), // 比 Lambda timeout(15min) 长一点
      retentionPeriod: cdk.Duration.days(1), // 1天没处理就丢弃
      deadLetterQueue: {
        // 失败3次进 DLQ
        queue: dlq,
        maxReceiveCount: 3,
      },
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
          path.resolve(__dirname, "../../deploy/.env.prod"),
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
        entry: path.join(__dirname, "../lambda/s3-to-r2-sync.ts"),
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
          SYNC_QUEUE_URL: syncQueue.queueUrl,
        },
      },
    );

    // 实时同步：SQS 事件源 → Lambda
    syncLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(syncQueue, {
        batchSize: 1, // 一次只处理一条消息
        enabled: true,
      }),
    );

    // 授权：Lambda 可以读 S3 + 读 Secrets Manager + 写 SQS DLQ + 发 SNS
    imageBucket.grantRead(syncLambda);
    // S3 事件通知 — 有新文件就发到 SQS
    imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED, // 监听 PutObject、CopyObject、CompleteMultipartUpload
      new s3n.SqsDestination(syncQueue),
    );
    r2Secret.grantRead(syncLambda);
    dlq.grantSendMessages(syncLambda);
    syncFailureTopic?.grantPublish(syncLambda);

    syncQueue.grantConsumeMessages(syncLambda); // Lambda 可以拉取+删除 SQS 消息
    imageBucket.grantPut(syncLambda); // 如果有需要写回 S3

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

    // 数据库安全组 — 只允许 ECS 访问
    const dbSecurityGroup = new ec2.SecurityGroup(this, "TarsierLabsDbSG", {
      vpc: this.vpc,
      description: "Security group for RDS PostgreSQL",
      allowAllOutbound: true,
    });

    // 允许 ECS 任务通过 5432 端口访问数据库
    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      "Allow PostgreSQL access from within VPC",
    );

    //RDS PostgreSQL 实例（PRIVATE_ISOLATED 子网 — 生产安全配置）
    const dbInstance = new rds.DatabaseInstance(this, "TarsierLabsPostgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [dbSecurityGroup],
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      multiAz: false,
      publiclyAccessible: false,
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      databaseName: "joymini",
    });
    // 输出数据库连接地址
    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: dbInstance.dbInstanceEndpointAddress,
      description: "RDS PostgreSQL endpoint address",
    });

    // ==================== API Gateway + Lambda (Phase 3) ====================
    // 1. Lambda 函数 — 最简单的 Serverless 函数
    const helloLambda = new lambdaNodejs.NodejsFunction(this, "HelloLambda", {
      entry: path.join(__dirname, "../lambda/hello-handler.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(10),
      description: "Serverless API handler",
    });

    // 2. API Gateway HTTP API — 暴露 Lambda 为 REST API
    const httpApi = new apigatewayv2.HttpApi(this, "TarsierLabsHttpApi", {
      apiName: "TarsierLabs Serverless API",
      description: "API Gateway + Lambda",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigatewayv2.CorsHttpMethod.GET],
      },
      createDefaultStage: true,
    });

    // 3. 添加路由: GET /hello → 触发 Lambda
    httpApi.addRoutes({
      path: "/hello",
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "HelloLambdaIntegration",
        helloLambda,
      ),
    });

    // 输出 API 地址
    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: httpApi.url!,
      description: "API Gateway HTTP API endpoint (GET /hello)",
    });
  }
}
