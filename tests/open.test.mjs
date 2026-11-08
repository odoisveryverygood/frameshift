import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseOptions } from "../scripts/open.mjs";

test("local connection resolves cwd or one project path without interpreting shell characters", () => {
  assert.equal(parseOptions([], "/workspace/app").project, "/workspace/app");
  const options = parseOptions(
    ["./my app;echo nope", "--no-browser", "--port", "4321"],
    "/workspace",
  );
  assert.equal(options.project, path.resolve("/workspace/my app;echo nope"));
  assert.equal(options.port, 4321);
  assert.equal(options.browser, false);
  assert.equal(parseOptions(["--fresh"]).fresh, true);
});

test("local connection rejects ambiguous folders, unknown options and invalid ports", () => {
  assert.throws(() => parseOptions(["one", "two"]), /one project/);
  assert.throws(() => parseOptions(["--upload"]), /Unknown option/);
  for (const port of ["0", "65536", "-1", "4310x", ""]) {
    assert.throws(() => parseOptions(["--port", port]), /port/i);
  }
});

test("local connection trims pasted paths and supports a machine-readable result", () => {
  const options = parseOptions(
    [" \n./my app \n", "--json", "--no-browser"],
    "/workspace",
  );
  assert.equal(options.project, path.resolve("/workspace/my app"));
  assert.equal(options.json, true);
  assert.equal(options.browser, false);
  assert.throws(() => parseOptions(["  "]), /nonempty/);
});
