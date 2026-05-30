import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";

export interface EcsFrontendConstructProps {
  vpc: ec2.Vpc;
}

export class EcsFrontendConstruct extends Construct {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcsFrontendConstructProps) {
    super(scope, id);

    const { vpc } = props;

    // 📦 ECR — Docker 镜像仓库
    this.repository = new ecr.Repository(this, "TarsierLabsEcrRepo", {
      repositoryName: "tarsier-labs",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // 🚢 ECS Cluster
    const cluster = new ecs.Cluster(this, "TarsierLabsCluster", {
      vpc,
      clusterName: "tarsier-labs-cluster",
    });

    // 🔒 ALB Security Group
    const albSg = new ec2.SecurityGroup(this, "TarsierLabsAlbSg", {
      vpc,
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
      vpc,
      description: "Allow traffic from ALB to ECS",
      allowAllOutbound: true,
    });
    ecsSg.connections.allowFrom(albSg, ec2.Port.tcp(3000), "Allow from ALB");

    // 🌐 ALB
    this.alb = new elbv2.ApplicationLoadBalancer(this, "TarsierLabsAlb", {
      vpc,
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
    const httpListener = this.alb.addListener("HttpListener", {
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
    const httpsListener = this.alb.addListener("HttpsListener", {
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
      image: ecs.ContainerImage.fromEcrRepository(this.repository, "latest"),
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

    // Target Group（挂在 HTTPS 监听器上）
    httpsListener.addTargets("FrontendBlogTarget", {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/zh/",
        interval: cdk.Duration.seconds(30),
      },
    });

    // Output
    new cdk.CfnOutput(this, "AlbDnsUrl", {
      value: this.alb.loadBalancerDnsName,
      description: "ALB Visit URL",
    });
  }
}
