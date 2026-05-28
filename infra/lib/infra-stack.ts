import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

export class InfraStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'InfraQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    // 🧱 VPC — 你的 AWS 网络地盘
    this.vpc = new ec2.Vpc(this, "TarsierLabsVpc", {
      maxAzs: 2, // 用 2 个可用区（高可用）
      natGateways: 0, // 省钱，不用 NAT Gateway（$0 费用）
    });

    // 📦 ECR — Docker 镜像仓库
    const repository = new ecr.Repository(this, "TarsierLabsEcrRepo", {
      repositoryName: "tarsier-labs",
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 删栈时自动删除仓库
      emptyOnDelete: true, // 代替 autoDeleteImages
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

    // 🔒 ECS Security Group
    const ecsSg = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: this.vpc,
      description: "Allow traffic from ALB to ECS",
      allowAllOutbound: true,
    });
    ecsSg.connections.allowFrom(albSg, ec2.Port.tcp(3000), "Allow from ALB");

    // 🌐 ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "TarsierLabsAlb", {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: "tarsier-labs-alb",
    });

    const listener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });

    // 📋 Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, "TarsierLabsTaskDef", {
      memoryLimitMiB: 512,
      cpu: 256,
      family: "tarsier-labs-task",
    });

    // 📦 Container
    const container = taskDef.addContainer("FrontendBlog", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      containerName: "frontend-blog",
      memoryLimitMiB: 512,
      cpu: 256,
      environment: {
        NODE_ENV: "production",
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
      desiredCount: 1, // CI/CD 推送镜像后自动启动容器
    });

    // 🎯 Target Group
    listener.addTargets("FrontendBlogTarget", {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP, // ← 加这行
      targets: [service],
      healthCheck: {
        path: "/",
        interval: cdk.Duration.seconds(30),
      },
    });

    // 📤 Output
    new cdk.CfnOutput(this, "AlbDnsUrl", {
      value: alb.loadBalancerDnsName,
      description: "🌐 访问地址",
    });
  }
}
