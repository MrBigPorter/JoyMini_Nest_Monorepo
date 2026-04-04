import { useEffect, useState } from "react";
import { FaceLivenessDetector } from "@aws-amplify/ui-react-liveness";
import { ThemeProvider } from "@aws-amplify/ui-react";

function App() {
  const [sessionId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("sessionId");
  });

  useEffect(() => {
    if (!sessionId) {
      console.warn("URL 中未检测到 sessionId");
    }
  }, [sessionId]);

  // 如果没有传入 sessionId，拦截在此
  if (!sessionId) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          backgroundColor: "black",
          color: "white",
        }}
      >
        Waiting for Session ID... (Please add ?sessionId=xxx to the URL)
      </div>
    );
  }

  // 渲染 AWS 活体检测 UI
  return (
    <ThemeProvider colorMode="dark">
      <div
        style={{ width: "100vw", height: "100vh", backgroundColor: "black" }}
      >
        <FaceLivenessDetector
          sessionId={sessionId}
          region="us-east-1"
          onAnalysisComplete={async () => {
            window.parent.postMessage(
              { type: "LIVENESS_RESULT", success: true },
              "https://app.joyminis.com", //  安全：只允许主站接收结果，防止数据被截获
            );
          }}
          onError={(livenessError: unknown) => {
            const errorMessage = typeof livenessError === 'string' 
              ? livenessError 
              : livenessError instanceof Error 
                ? livenessError.message 
                : String(livenessError);
            window.parent.postMessage(
              { type: "LIVENESS_RESULT", success: false, error: errorMessage },
              "https://app.joyminis.com", //  同样指定目标域名
            );
          }}
        />
      </div>
    </ThemeProvider>
  );
}

export default App;
