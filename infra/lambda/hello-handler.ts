/**
 * 简单的 Lambda 函数 — 通过 API Gateway 触发
 * Serverless、按需计费、无缝扩缩容
 */
export const handler = async (event: any) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      service: "TarsierLabs Serverless API",
      message: "Hello from Lambda + API Gateway!",
      timestamp: new Date().toISOString(),
      path: event.rawPath || "/",
      method: event.requestContext?.http?.method || "GET",
    }),
  };
};
