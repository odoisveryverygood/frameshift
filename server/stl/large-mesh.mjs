/** Streaming full-fidelity binary STL normalization with a separately labelled display sample. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_BYTES = 768 * 1024 * 1024;
const MAX_TRIANGLES = 15_000_000;
const MAX_PREVIEW_TRIANGLES = 150_000;
const FACETS_PER_CHUNK = 20_000;
const scaleToMeters = Object.freeze({ mm: .001, cm: .01, m: 1, in: .0254 });

async function readFully(file, buffer, length, position, signal) {
  let offset = 0;
  while (offset < length) {
    signal?.throwIfAborted();
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw Error('Binary STL became truncated while reading; no repaired file was published.');
    offset += bytesRead;
  }
}
async function writeFully(file, buffer, length, position, signal) {
  let offset = 0;
  while (offset < length) {
    signal?.throwIfAborted();
    const { bytesWritten } = await file.write(buffer, offset, length - offset, position == null ? null : position + offset);
    if (!bytesWritten) throw Error('Could not write the complete repaired STL.');
    offset += bytesWritten;
  }
}
async function fileSha256(filePath, signal) {
  const handle = await fs.open(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024), digest = crypto.createHash('sha256');
  try {
    let offset = 0;
    while (true) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    return digest.digest('hex');
  } finally { await handle.close(); }
}

export async function analyzeLargeBinaryStl(inputPath, { outputPath, units, previewTriangles = MAX_PREVIEW_TRIANGLES, signal } = {}) {
  if (!Object.hasOwn(scaleToMeters, units)) throw Error('Choose the STL export units: mm, cm, m, or in. Units are not inferred.');
  if (typeof inputPath !== 'string' || !inputPath || typeof outputPath !== 'string' || !outputPath)
    throw Error('Input and output STL file paths are required.');
  if (!Number.isInteger(previewTriangles) || previewTriangles < 1 || previewTriangles > MAX_PREVIEW_TRIANGLES)
    throw Error(`Display sample must contain 1–${MAX_PREVIEW_TRIANGLES.toLocaleString()} triangles.`);
  const sourcePath = path.resolve(inputPath), targetPath = path.resolve(outputPath);
  if (sourcePath === targetPath) throw Error('The repaired STL must use a different path; the original is retained.');
  signal?.throwIfAborted();
  const input = await fs.open(sourcePath, 'r');
  let output = null, temporaryPath = null, published = false;
  try {
    const initial = await input.stat({ bigint: true });
    if (!initial.isFile()) throw Error('STL input must be a regular file.');
    if (initial.size > BigInt(MAX_BYTES)) throw Error('Binary STL exceeds the 768 MiB streaming import limit.');
    if (initial.size < 84n) throw Error('Binary STL is too short to contain its header and triangle count.');
    const header = Buffer.allocUnsafe(84); await readFully(input, header, 84, 0, signal);
    const inputTriangles = header.readUInt32LE(80);
    if (!inputTriangles) throw Error('Binary STL contains zero triangles.');
    if (inputTriangles > MAX_TRIANGLES) throw Error('Binary STL exceeds the 15,000,000 triangle streaming limit.');
    const expectedBytes = 84 + inputTriangles * 50;
    if (Number(initial.size) !== expectedBytes)
      throw Error(Number(initial.size) < expectedBytes ? 'Binary STL is truncated: its declared triangle data is incomplete.' : 'Binary STL length does not match its declared triangle count; no trailing bytes were discarded.');
    if (await fs.lstat(targetPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; }))
      throw Error('The repaired output path already exists; it was not overwritten.');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
    output = await fs.open(temporaryPath, 'wx', 0o600);
    const outputHeader = Buffer.from(header);
    outputHeader.writeUInt32LE(0, 80); // Preserve the 80-byte source header and facet attributes.
    await writeFully(output, outputHeader, outputHeader.length, null, signal);
    const rawDigest = crypto.createHash('sha256'); rawDigest.update(header);
    const chunk = Buffer.allocUnsafe(FACETS_PER_CHUNK * 50);
    const sampleCapacity = Math.min(inputTriangles, previewTriangles);
    const sample = new Float32Array(sampleCapacity * 9), sampleIndices = new Uint32Array(sampleCapacity);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const removed = { nonFinite: 0, degenerate: 0 };
    let outputTriangles = 0, sampleCount = 0, nextSample = 0, invalidNormals = 0, correctedNormals = 0;
    for (let first = 0; first < inputTriangles; first += FACETS_PER_CHUNK) {
      signal?.throwIfAborted();
      const count = Math.min(FACETS_PER_CHUNK, inputTriangles - first), bytes = count * 50;
      await readFully(input, chunk, bytes, 84 + first * 50, signal);
      rawDigest.update(chunk.subarray(0, bytes)); // Hash original bytes before in-place compaction.
      let writeOffset = 0;
      for (let facet = 0; facet < count; facet++) {
        const at = facet * 50, sourceIndex = first + facet;
        const nx = chunk.readFloatLE(at), ny = chunk.readFloatLE(at + 4), nz = chunk.readFloatLE(at + 8);
        const suppliedLength = Math.hypot(nx, ny, nz);
        if (!Number.isFinite(suppliedLength) || !suppliedLength) invalidNormals++;
        const ax = chunk.readFloatLE(at + 12), ay = chunk.readFloatLE(at + 16), az = chunk.readFloatLE(at + 20);
        const bx = chunk.readFloatLE(at + 24), by = chunk.readFloatLE(at + 28), bz = chunk.readFloatLE(at + 32);
        const cx = chunk.readFloatLE(at + 36), cy = chunk.readFloatLE(at + 40), cz = chunk.readFloatLE(at + 44);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) {
          removed.nonFinite++; continue;
        }
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, length = Math.hypot(x, y, z);
        if (!length) { removed.degenerate++; continue; }
        const rx = x / length, ry = y / length, rz = z / length;
        if (!Number.isFinite(suppliedLength) || !suppliedLength || Math.abs(suppliedLength - 1) > 1e-5 || (nx * rx + ny * ry + nz * rz) / suppliedLength < 1 - 1e-5) correctedNormals++;
        min[0] = Math.min(min[0], ax, bx, cx); min[1] = Math.min(min[1], ay, by, cy); min[2] = Math.min(min[2], az, bz, cz);
        max[0] = Math.max(max[0], ax, bx, cx); max[1] = Math.max(max[1], ay, by, cy); max[2] = Math.max(max[2], az, bz, cz);
        if (sampleCount < sampleCapacity && sourceIndex >= nextSample) {
          const index = sampleCount * 9;
          sample[index] = ax; sample[index + 1] = ay; sample[index + 2] = az;
          sample[index + 3] = bx; sample[index + 4] = by; sample[index + 5] = bz;
          sample[index + 6] = cx; sample[index + 7] = cy; sample[index + 8] = cz;
          sampleIndices[sampleCount++] = sourceIndex;
          nextSample = sampleCapacity > 1 ? Math.floor(sampleCount * (inputTriangles - 1) / (sampleCapacity - 1)) : inputTriangles;
        }
        if (writeOffset !== at) chunk.copy(chunk, writeOffset, at, at + 50);
        chunk.writeFloatLE(rx, writeOffset); chunk.writeFloatLE(ry, writeOffset + 4); chunk.writeFloatLE(rz, writeOffset + 8);
        // Vertex bytes, attribute bytes and source winding remain unchanged.
        writeOffset += 50; outputTriangles++;
      }
      await writeFully(output, chunk, writeOffset, null, signal);
    }
    if (!outputTriangles) throw Error('No usable finite, nonzero-area triangles remain. No repaired STL was published.');
    outputHeader.writeUInt32LE(outputTriangles, 80);
    await writeFully(output, outputHeader, 84, 0, signal);
    await output.sync(); await output.close(); output = null;
    const final = await input.stat({ bigint: true }), currentPath = await fs.stat(sourcePath, { bigint: true });
    if (initial.size !== final.size || initial.mtimeNs !== final.mtimeNs || initial.ino !== currentPath.ino || initial.size !== currentPath.size || initial.mtimeNs !== currentPath.mtimeNs)
      throw Error('Original STL changed during normalization; no repaired file was published.');
    const inputSha256 = rawDigest.digest('hex'), outputSha256 = await fileSha256(temporaryPath, signal);
    const positions = sample.slice(0, sampleCount * 9), componentIds = new Uint32Array(sampleCount);
    const indices = sampleIndices.subarray(0, sampleCount);
    const bounds = { min, max, size: max.map((value, axis) => value - min[axis]) };
    const issues = [
      'This is a display-only sample; the viewport does not render the full repaired robot.',
      'Global duplicate detection, connected-shell topology, boundary/non-manifold edges, relative winding and self-intersections were not assessed by the streaming path.',
    ];
    if (removed.nonFinite) issues.push(`${removed.nonFinite} non-finite facets were excluded from the full output; their missing surface was not reconstructed.`);
    if (removed.degenerate) issues.push(`${removed.degenerate} zero-area facets were excluded from the full output.`);
    if (correctedNormals) issues.push(`${correctedNormals} supplied facet normals were corrected from the retained triangle geometry.`);
    const report = {
      version: 1, largeMesh: true, previewOnly: true, previewTriangles: sampleCount, headerPreserved: true, mode: 'streaming-full-binary-with-display-sample', format: 'binary', units, scaleToMeters: scaleToMeters[units],
      inputBytes: expectedBytes, outputBytes: 84 + outputTriangles * 50,
      inputTriangles, outputTriangles, fullOutputTriangles: outputTriangles, displayTriangles: sampleCount,
      inputSha256, originalSha256: inputSha256, outputSha256, repairedSha256: outputSha256,
      originalRetained: true, fullGeometryRetained: removed.nonFinite === 0 && removed.degenerate === 0,
      retainedEveryUsableTriangle: true, removed, removedNonFinite: removed.nonFinite, removedDegenerate: removed.degenerate,
      removedDuplicate: null, duplicateDetection: 'not-assessed', invalidNormals,
      recalculatedNormals: outputTriangles, normalsRecalculated: outputTriangles, correctedNormals, windingFlipped: 0,
      bounds, connectedComponents: null, boundaryEdges: null, nonManifoldEdges: null,
      topology: { assessed: false, components: [], boundaryEdges: null, nonManifoldEdges: null, reason: 'Streaming normalization does not perform global topology analysis.' },
      geometryChanged: removed.nonFinite > 0 || removed.degenerate > 0,
      geometryLoss: removed.nonFinite > 0 || removed.degenerate > 0,
      requiresReview: true, status: 'normalized-with-unassessed-topology', issues,
      preview: {
        displayOnly: true, sampled: sampleCount < outputTriangles, triangles: sampleCount, fullOutputTriangles: outputTriangles,
        maximumTriangles: previewTriangles,
        policy: 'Evenly targeted source-facet indices across the complete input, selecting the next usable facet after each target.',
        firstSourceFacet: sampleCount ? indices[0] : null, lastSourceFacet: sampleCount ? indices[sampleCount - 1] : null,
        sourceIndicesSha256: crypto.createHash('sha256').update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)).digest('hex'),
        components: 'Unknown; one display group is not a CAD part or a topological component.',
      },
      displayOnly: true,
      limits: { maxBytes: MAX_BYTES, maxTriangles: MAX_TRIANGLES, maxPreviewTriangles: MAX_PREVIEW_TRIANGLES, chunkBytes: FACETS_PER_CHUNK * 50 },
      limitations: [
        'The full repaired STL retains every usable triangle; only the separately labelled viewer sample is reduced.',
        'Vertex coordinates, attribute bytes and winding of retained facets are unchanged. Units were supplied by the user.',
        'No hole filling, mechanical validation, manufacturing suitability, full-mesh visual equivalence or full-model rendering performance is claimed.',
      ],
    };
    signal?.throwIfAborted();
    // A hard-link publish is atomic and refuses to replace an existing target.
    await fs.link(temporaryPath, targetPath); published = true;
    await fs.unlink(temporaryPath); temporaryPath = null;
    return { report, positions, componentIds };
  } finally {
    await output?.close().catch(() => {});
    await input.close();
    if (temporaryPath) await fs.unlink(temporaryPath).catch(() => {});
    // Once published, targetPath is a complete file; failures never delete the original.
    void published;
  }
}
export const LARGE_STL_LIMITS = Object.freeze({ maxBytes: MAX_BYTES, maxTriangles: MAX_TRIANGLES, maxPreviewTriangles: MAX_PREVIEW_TRIANGLES });
