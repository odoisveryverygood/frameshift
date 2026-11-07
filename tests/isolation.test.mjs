import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedCommand } from "../server/isolation.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function execute(argv, env, cwd) {
  return new Promise((resolve, reject) => {
    let stdout = "",
      stderr = "";
    const child = spawn(argv[0], argv.slice(1), {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Isolation test process timed out"));
    }, 10000);
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test(
  "build command sanitizes credentials and enforces macOS filesystem/network restrictions",
  { skip: process.platform !== "darwin" },
  async () => {
    await fs.mkdir(path.join(ROOT, ".frameshift"), { recursive: true });
    const fixture = await fs.mkdtemp(
      path.join(ROOT, ".frameshift", "isolation-test-"),
    );
    const workspace = path.join(fixture, "workspace");
    await fs.mkdir(workspace);
    const sentinel = path.join(fixture, "harmless-sentinel.txt");
    await fs.writeFile(sentinel, "harmless sentinel");
    let networkRequests = 0;
    const server = http.createServer((req, res) => {
      networkRequests++;
      res.end("local test endpoint");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const before = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
      const script = `import fs from 'node:fs';const result={credentialPresent:Boolean(process.env.OPENAI_API_KEY)};try{fs.writeFileSync('inside.txt','allowed');result.insideWrite=true}catch(e){result.insideError=e.code}try{fs.readFileSync(${JSON.stringify(sentinel)},'utf8');result.siblingRead=true}catch(e){result.siblingRead=false;result.readError=e.code}try{fs.writeFileSync(${JSON.stringify(sentinel + ".new")},'denied');result.siblingWrite=true}catch(e){result.siblingWrite=false;result.writeError=e.code}try{await fetch('http://127.0.0.1:${server.address().port}',{signal:AbortSignal.timeout(1000)});result.network=true}catch{result.network=false}console.log(JSON.stringify(result));`;
      const command = await isolatedCommand(
        [process.execPath, "--input-type=module", "-e", script],
        workspace,
      );
      assert.equal(command.env.OPENAI_API_KEY, undefined);
      assert.equal(command.argv[0], "/usr/bin/sandbox-exec");
      const result = await execute(command.argv, command.env, workspace);
      assert.equal(result.code, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.insideWrite, true);
      assert.equal(output.siblingRead, false);
      assert.equal(output.siblingWrite, false);
      assert.equal(output.network, false);
      assert.equal(output.credentialPresent, false);
      assert.equal(networkRequests, 0);
      assert.equal(
        await fs.readFile(path.join(workspace, "inside.txt"), "utf8"),
        "allowed",
      );
      assert.equal(await fs.readFile(sentinel, "utf8"), "harmless sentinel");
      await assert.rejects(() => fs.access(sentinel + ".new"));
    } finally {
      if (before === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before;
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await fs.rm(fixture, { recursive: true, force: true });
    }
  },
);

test("sanitized build environment does not forward unrelated provider credentials", async () => {
  await fs.mkdir(path.join(ROOT, ".frameshift"), { recursive: true });
  const workspace = await fs.mkdtemp(
    path.join(ROOT, ".frameshift", "isolation-env-"),
  );
  const before = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  try {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-other-key";
    const command = await isolatedCommand(
      [process.execPath, "--version"],
      workspace,
    );
    assert.equal(command.env.OPENAI_API_KEY, undefined);
    assert.equal(command.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(command.env.NPM_CONFIG_USERCONFIG, "/dev/null");
    assert.equal(command.env.FRAMESHIFT_BUILD, "1");
    assert.equal(command.env.NODE_ENV, "production");
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
