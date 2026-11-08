# Sift hosted operator workspace

This configuration is prepared for Railway or Docker. **A local container build was attempted but Docker failed before executing the Dockerfile: its storage returned an input/output error creating a temporary builder directory. No container build, Railway deployment, hosted browser flow or hosted optimization has been verified.** Local ZIP upload, extraction/discovery, explicit trust and existing project connection are separately testable. Do not describe this as a public upload service or a sandbox for unknown users.

Sift runs application builds and package downloads after an operator explicitly trusts a project. Linux builds currently have a sanitized environment, but no per-project filesystem/network security sandbox. A login token restricts who can submit work; it does not make arbitrary code safe. Deploy only for your own trusted team, in a dedicated service with no unrelated data or broad cloud credentials. One shared workspace, operator token and worker are supported; there are no tenant accounts, per-user storage boundaries, billing or public signup.

## Configuration

The Docker image uses Node 24, Chromium from Debian, Python plus the pinned Fetch/uAgents dependencies, and one web process supervising one job worker. `CHROME_EXECUTABLE_PATH=/usr/bin/chromium` overrides the local Chrome channel. Chromium may render with software graphics in a cloud container. Benchmark comparisons apply to that container/device and are not proof of physical GPU performance or faster FPS on every device.

Create a Railway service from this repository using `Dockerfile`, attach a persistent volume at `/data`, use one replica, and set these variables before starting:

| Variable | Value |
| --- | --- |
| `EARL_HOSTED` | `1` (image default) |
| `EARL_PUBLIC_ORIGIN` | The exact HTTPS service origin, e.g. `https://your-service.up.railway.app`, without a trailing slash |
| `EARL_ADMIN_TOKEN` | A newly generated private random value of at least 24 characters; share only with trusted team members |
| `FRAMESHIFT_DATA_DIR` | `/data` (image default, persistent volume required) |
| `PORT` | Railway supplies this; local Docker can use `4310` |
| Provider variables | Configure the provider you actually use, as described in `.env.example`; do not put secrets in source or the image |

The container entrypoint sets ownership of the volume root and drops to the `node` user before starting the web server and worker. Do not override the Docker entrypoint. The web server binds `0.0.0.0` only when hosted mode is enabled. `/healthz` is a public liveness check; it does not assert that model credentials, Chrome rendering or the worker are ready. Inspect authenticated `/api/state` for worker status. Provider keys stay in server environment variables. `.env.local`, runtime data and local node_modules are excluded from the build context.

For local Docker validation after building an image (not run by this change):

```sh
docker build -t sift-operator .
docker run --rm --init -p 4310:4310 -v sift-data:/data \
  -e EARL_PUBLIC_ORIGIN=http://localhost:4310 \
  -e EARL_ADMIN_TOKEN \
  -e PORT=4310 sift-operator
```

Set `EARL_ADMIN_TOKEN` privately in the shell before that command; do not paste a real token into a committed command. HTTPS is required for non-loopback origins. The web login sets a signed HttpOnly, SameSite=Strict session cookie lasting eight hours (Secure on HTTPS). Bearer authorization is also available for trusted programmatic clients. Changing the operator token invalidates existing sessions. Browser preview/opaque-iframe authentication needs a hosted end-to-end check before relying on it.

## Upload and trust

1. Sign in with the operator token.
2. Submit one application's ZIP through the project picker. `POST /api/uploads/project` takes a raw `application/zip` body and an optional URI-encoded `X-Upload-Name` header.
3. Review `{uploadId,path,inspection,warnings,requiresTrust:true}`. This stage extracts files and reads project metadata/source only. It does not install packages, load Vite config, run scripts or launch the application.
4. Explicitly confirm trust and connect through `POST /api/projects` with `{path,trusted:true}`. Dependency preparation and later builds may execute trusted code. Supported automatic integration starts with Vite + Three.js WebGL; a ZIP is not universal support for every framework, private package registry or native dependency.
5. Profile the baseline, then start the real optimization. Open the resulting evidence/receipt and inspect the patch. Never substitute invented metrics if a build, model call or renderer fails.

ZIP ingestion uses `yauzl` with lazy entry processing and strict filenames. Limits are 20 MiB compressed, 60 MiB declared/actual expanded data, 10 MiB per file, 2,000 entries, 512-byte paths, 15 path segments, and 20 retained uploads / 512 MiB retained extracted data. The service checks disk headroom and admits one upload at a time. Dependency/generated directories, `.git`, environment files, common credential filenames and key files are omitted. Unsafe paths, symlinks/special nodes, encryption, duplicate/case-conflicting paths, ambiguous/missing project manifests, damaged CRCs and inconsistent sizes are rejected; failed imports are removed. Exactly one non-excluded `package.json` is required. Upload one application from a monorepo, excluding its dependencies.

Credential filtering cannot detect arbitrary secrets pasted into ordinary source files. Review the ZIP before sending it. Large textures/assets may exceed limits; private dependency credentials and file/git/workspace package references require separate supported handling, not automatic secret upload. Uploads currently persist until the operator removes their UUID directory under `/data/uploads`; remove only imports no longer needed by projects. Do not delete an upload backing a connected project.

Hosted `/api/inspect` and `/api/projects` accept only paths returned by a managed, completed upload. API/actions and project previews require authentication. The local loopback-only workflow remains available when `EARL_HOSTED` is unset.

## Validation remaining before use

Build the image; verify Chromium launches and a real project renders; check that both worker and web restart against the same volume; test signed login and preview requests through the actual HTTPS domain; upload a clean project, confirm no scripts execute before trust, run profile/optimize, and inspect the real receipt. Test provider calls only with the intended application budget. Do not promise hosted operation before these pass.
