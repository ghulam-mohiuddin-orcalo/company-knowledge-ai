// Deterministic OpenAI-compatible stand-in for E2E runs (no paid APIs):
// embeddings use the offline lexical model; chat answers with the evidence
// sentence that best matches the question and cites its source label, or
// abstains. POST /control {"failNext": n} makes the next n chat calls fail.
import { createServer } from 'node:http';
import { HashedTermEmbeddingProvider, terms } from '@cka/ai';

const PORT = Number(process.env.AI_PORT ?? 39102);
const embedder = new HashedTermEmbeddingProvider(1536);
let failNext = 0;

function extractive(user) {
  const question = new Set(
    terms(/<question>\n([\s\S]*?)\n<\/question>/.exec(user)?.[1] ?? ''),
  );
  let best = { overlap: 0, sentence: '', label: '' };
  for (const [, label, content] of user.matchAll(
    /<source id="(SOURCE_\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/g,
  )) {
    for (const sentence of content.split(/(?<=[.!?])\s+|\n+/)) {
      const overlap = new Set(terms(sentence).filter((t) => question.has(t)))
        .size;
      if (overlap > best.overlap)
        best = { overlap, sentence: sentence.trim(), label };
    }
  }
  return best.overlap >= 2 ? `${best.sentence} [${best.label}]` : 'NO_ANSWER';
}

createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', () => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/health') return reply(200, { ok: true });
    if (request.url === '/control') {
      failNext = JSON.parse(raw).failNext;
      return reply(200, { failNext });
    }
    const body = JSON.parse(raw);
    if (request.url.endsWith('/embeddings')) {
      return reply(200, {
        model: body.model,
        data: body.input.map((text, index) => ({
          index,
          embedding: embedder.vector(text),
        })),
      });
    }
    if (failNext > 0) {
      failNext--;
      return reply(503, { error: { message: 'stand-in outage' } });
    }
    return reply(200, {
      model: body.model,
      choices: [
        {
          finish_reason: 'stop',
          message: { content: extractive(body.messages[1].content) },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  });
}).listen(PORT, '127.0.0.1');
