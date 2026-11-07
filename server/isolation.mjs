import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function isolatedCommand(argv, workspace) {
  const folder = path.join(workspace, ".frameshift-build");
  await fs.mkdir(folder, { recursive: true });
  const env = Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TMPDIR", "USER", "LOGNAME", "SYSTEMROOT"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  Object.assign(env, {
    NODE_ENV: "production",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_CACHE: path.join(folder, "npm-cache"),
    TMPDIR: folder,
    FRAMESHIFT_BUILD: "1",
  });
  if (process.platform !== "darwin")
    return {
      argv,
      env,
      isolation:
        "process with sanitized environment; OS filesystem restrictions unavailable",
    };
  await fs.access("/usr/bin/sandbox-exec");
  const roots = [
    workspace,
    path.join(ROOT, "node_modules"),
    path.join(ROOT, "server"),
    path.join(ROOT, "sdk"),
  ];
  const modules = path.join(workspace, "node_modules");
  for (const name of await fs.readdir(modules).catch(() => [])) {
    const target = await fs
      .realpath(path.join(modules, name))
      .catch(() => null);
    if (target && !target.startsWith(workspace + path.sep)) roots.push(target);
  }
  const quote = (x) => JSON.stringify(x);
  const allowed = [...new Set(roots)];
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-read-data (require-all (subpath "/Users") ${allowed.map((p) => "(require-not (subpath " + quote(p) + "))").join(" ")} (require-not (literal ${quote(path.join(ROOT, "package.json"))})) ))`,
    `(deny file-write* (require-all (subpath "/") (require-not (subpath ${quote(workspace)})) (require-not (literal "/dev/null"))))`,
  ].join("\n");
  const file = path.join(folder, "build.sb");
  await fs.writeFile(file, profile);
  return {
    argv: ["/usr/bin/sandbox-exec", "-f", file, ...argv],
    env,
    isolation: "macOS filesystem-restricted, network-denied build process",
  };
}
