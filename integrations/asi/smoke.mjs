// One bounded live request; no project source or credentials are logged.
import fs from 'node:fs';
import dotenv from 'dotenv';

const local = fs.existsSync('.env') ? dotenv.parse(fs.readFileSync('.env')) : {};
const key = process.env.ASI_ONE_API_KEY || local.ASI_ONE_API_KEY;
if (!key) throw new Error('Set ASI_ONE_API_KEY in the backend environment.');
const response = await fetch('https://api.asi1.ai/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'asi1-mini', messages: [{ role: 'user', content: 'Reply with exactly EARL_OK.' }], max_tokens: 24, stream: false }),
  signal: AbortSignal.timeout(30000),
});
const data = await response.json();
const passed = response.ok && data.choices?.[0]?.message?.content?.trim() === 'EARL_OK';
console.log(JSON.stringify({ status: response.status, model: data.model, passed }));
if (!passed) process.exitCode = 1;
