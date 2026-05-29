import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { Readable } from "stream";

interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const S3_BUCKET = process.env.S3_BUCKET || "joymini-images-prod";
const S3_REGION = process.env.AWS_REGION || "ap-southeast-1";
const SECRET_NAME = process.env.SECRET_NAME || "joymini/r2-credentials";
const DLQ_URL = process.env.DLQ_URL!;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

const secretsClient = new SecretsManagerClient({ region: S3_REGION });

//  把数组切成批，用于并发控制
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );
}

export async function handler() {
  console.log(`Starting S3→R2 sync: bucket=${S3_BUCKET}, region=${S3_REGION}`);

  // Step 1: Read R2 credentials from Secrets Manager
  console.log(`Reading R2 credentials from Secrets Manager: ${SECRET_NAME}`);
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME }),
  );
  if (!secretResponse.SecretString) {
    throw new Error(`Secret ${SECRET_NAME} has no SecretString`);
  }
  const r2Creds: R2Credentials = JSON.parse(secretResponse.SecretString);
  console.log(
    `R2 credentials loaded: account=${r2Creds.accountId}, bucket=${r2Creds.bucket}`,
  );

  // Step 2: Create S3 clients
  const s3Client = new S3Client({ region: S3_REGION });
  const r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${r2Creds.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Creds.accessKeyId,
      secretAccessKey: r2Creds.secretAccessKey,
    },
  });

  const sqsClient = new SQSClient({ region: S3_REGION });

  // Step 3: List S3 objects (paginated) and sync to R2
  let continuationToken: string | undefined;
  let syncedCount = 0;
  let skippedCount = 0;
  let pageCount = 0;
  let failedKeys: string[] = [];

  do {
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = listResponse.Contents || [];
    pageCount++;
    console.log(`Page ${pageCount}: found ${objects.length} objects`);

    // ====== 分流：小文件（<10MB）并发，大文件（>=10MB）流式 ======
    const SMALL_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
    const smallFiles = objects.filter(
      (o) => o.Key && o.Size! < SMALL_FILE_THRESHOLD,
    );
    const largeFiles = objects.filter(
      (o) => o.Key && o.Size! >= SMALL_FILE_THRESHOLD,
    );

    console.log(
      `Split: ${smallFiles.length} small files (<10MB), ${largeFiles.length} large files (>=10MB)`,
    );

    // ====== 小文件：20 个一批并发 ======
    for (const batch of chunk(smallFiles, 20)) {
      const results = await Promise.allSettled(
        batch.map((obj) => syncFile(obj, s3Client, r2Client, r2Creds.bucket)),
      );

      results.forEach((r, i) => {
        if (r.status === "rejected") {
          failedKeys.push(batch[i].Key!);
          console.error(`❌ Failed: ${batch[i].Key}`, r.reason);
        } else if (r.value === "synced") {
          syncedCount++;
        } else {
          skippedCount++;
        }
      });

      if ((syncedCount + skippedCount) % 100 === 0) {
        console.log(`Progress: synced=${syncedCount}, skipped=${skippedCount}`);
      }
    }

    // ====== 大文件：流式串行（不占内存）+ ETag 增量检查 ======
    for (const obj of largeFiles) {
      // ETag 检查：R2 已有相同 ETag 则跳过
      try {
        const r2Head = await r2Client.send(
          new HeadObjectCommand({ Bucket: r2Creds.bucket, Key: obj.Key! }),
        );
        const stripQuotes = (e?: string) =>
          e?.replace(/^"/, "").replace(/"$/, "");
        if (stripQuotes(r2Head.ETag) === stripQuotes(obj.ETag)) {
          skippedCount++;
          console.log(`⏭️ Skipped (ETag match): ${obj.Key}`);
          continue;
        }
      } catch {}

      try {
        const getCmd = new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: obj.Key!,
        });
        const getResp = await s3Client.send(getCmd);
        const body = getResp.Body as Readable;

        await r2Client.send(
          new PutObjectCommand({
            Bucket: r2Creds.bucket,
            Key: obj.Key!,
            Body: body,
            ContentType: getResp.ContentType,
          }),
        );
        syncedCount++;
        console.log(`Stream synced: ${obj.Key}`);
      } catch (err) {
        failedKeys.push(obj.Key!);
        console.error(`Stream failed for ${obj.Key}`, err);
      }
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  // ============================================
  //  DLQ 上报 — 有失败文件就推送到 SQS
  // ============================================
  if (failedKeys.length > 0) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: DLQ_URL,
        MessageBody: JSON.stringify({
          failedKeys,
          timestamp: new Date().toISOString(),
        }),
      }),
    );
    console.warn(
      ` ${failedKeys.length} files failed, pushed to DLQ for manual review`,
    );
  }

  // ============================================
  //  SNS 通知 — 有失败文件就发汇总邮件
  // ============================================
  if (failedKeys.length > 0 && SNS_TOPIC_ARN) {
    const snsClient = new SNSClient({ region: S3_REGION });
    await snsClient.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: `⚠️ S3-R2 Sync: ${failedKeys.length} files failed`,
        Message: JSON.stringify(
          {
            failedCount: failedKeys.length,
            syncedCount,
            skippedCount,
            failedKeys,
            timestamp: new Date().toISOString(),
            bucket: S3_BUCKET,
          },
          null,
          2,
        ),
      }),
    );
    console.log(
      ` SNS notification sent: ${failedKeys.length} failures to topic ${SNS_TOPIC_ARN}`,
    );
  }

  console.log(` Sync complete: synced=${syncedCount}, skipped=${skippedCount}`);
  return { statusCode: 200, syncedCount, skippedCount };
}

// ============================================
//  syncFile() — 同步单个小文件（含 ETag 增量检查）
// ============================================
async function syncFile(
  obj: { Key?: string; ETag?: string },
  s3Client: S3Client,
  r2Client: S3Client,
  r2Bucket: string,
): Promise<"skipped" | "synced"> {
  // ETag 增量检查：R2 已有相同 ETag 则跳过
  try {
    const r2Head = await r2Client.send(
      new HeadObjectCommand({ Bucket: r2Bucket, Key: obj.Key! }),
    );
    const stripQuotes = (e?: string) => e?.replace(/^"/, "").replace(/"$/, "");
    if (stripQuotes(r2Head.ETag) === stripQuotes(obj.ETag)) {
      return "skipped";
    }
  } catch {}

  // 从 S3 读取 → 上传到 R2
  const s3Get = await s3Client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key! }),
  );
  const body = await s3Get.Body?.transformToByteArray();
  if (!body) throw new Error(`Empty body: ${obj.Key}`);

  await r2Client.send(
    new PutObjectCommand({
      Bucket: r2Bucket,
      Key: obj.Key!,
      Body: body,
      ContentType: s3Get.ContentType,
    }),
  );
  return "synced";
}
