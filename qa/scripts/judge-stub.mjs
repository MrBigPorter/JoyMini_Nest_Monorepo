/**
 * Minimal OpenAI-compatible judge stub for QA.
 *
 * The AI eval judge talks to an OpenAI-compatible /chat/completions endpoint.
 * Pointing AI_EVAL_JUDGE_BASE_URL at this stub lets the ADMIN/SUPER_ADMIN role
 * gate be verified end-to-end without calling a third-party provider.
 *
 *   node qa/scripts/judge-stub.mjs [port]
 */
import http from 'node:http';

const port = Number(process.argv[2] || process.env.QA_JUDGE_STUB_PORT || 4199);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'llama-3.3-70b-versatile', object: 'model' }],
      }),
    );
    return;
  }

  if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      // Deterministic failure hook for the Batch 4 FAILED-run UI test.
      // A question containing qa_judge_fail makes the judge call throw.
      if (body.includes('qa_judge_fail')) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: { message: 'qa simulated judge failure', type: 'qa' },
          }),
        );
        return;
      }

      // Read the payload only to prove it arrived; never log user content.
      const payload = JSON.stringify({
        id: 'chatcmpl-qa-stub',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'llama-3.3-70b-versatile',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                verdict: 'solved',
                score: 1,
                reason: 'qa judge stub',
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
      const send = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payload);
      };
      // Deterministic slow hook: lets QA cancel a run while it is mid-judge.
      // Only questions containing `qa_eval_slow` are delayed; other suites
      // keep the instant response.
      if (body.includes('qa_eval_slow')) {
        setTimeout(send, 4_000);
      } else {
        send();
      }
      void body;
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[qa-judge-stub] listening on http://127.0.0.1:${port}`);
});
