/** Opt-in real native CLI verification; artifacts remain in the selected output directory. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { lint, render, snapshot } from '../src/video.ts'
import { cliPath, outputDirectory } from '../src/runner.ts'
import assert from 'node:assert/strict'

const output = resolve(process.argv[2] ?? '../.tmp/video-toolkit/native-validation')
await mkdir(output, { recursive: true })
const project = join(output, '中文 project')
await cp(new URL('./fixtures/project/', import.meta.url), project, { recursive: true })
const signal = AbortSignal.timeout(180_000)
async function command(argv, cwd = project) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' } })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('close', exitCode => { resolve({ exitCode, stdout, stderr }) })
  })
}
const run = (args, cwd) => command([process.execPath, cliPath(), ...args], cwd)
const valid = await lint(project, run, signal)
assert.equal(valid.ok, true)
const invalid = join(output, 'invalid-project')
await mkdir(invalid, { recursive: true })
await writeFile(join(invalid, 'index.html'), '<!doctype html><html><body>Missing composition</body></html>')
const findings = await lint(invalid, run, signal)
assert.equal(findings.ok, false)
assert.ok(findings.errorCount > 0)
const probe = process.env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe'
async function info(path) {
  const result = await command([probe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])
  assert.equal(result.exitCode, 0, result.stderr)
  return JSON.parse(result.stdout)
}
const sheets = []
for (const times of [[0], [0.9, 0, 0.1], [0.9, 0, 0.1, 0.1], [0.9, 0, 0.1, 0.1, 0.2, 0.3, 0.5, 0.7, 0.99]]) {
  const result = await snapshot(project, times, await outputDirectory(project), run, signal)
  const metadata = await info(result.sheetPath)
  const { width, height } = metadata.streams[0]
  assert.equal(width, 1816)
  assert.equal(height, result.rows * 364 + (result.rows + 1) * 4)
  assert.deepEqual(result.frames.map(frame => frame.time), times)
  if (times.length === 4 || times.length === 9) {
    assert.deepEqual(await readFile(result.frames[2].path), await readFile(result.frames[3].path))
  }
  sheets.push({ count: times.length, columns: result.columns, rows: result.rows, width, height, timestamps: times })
  console.log(`Native snapshot ${times.length}: ${width}×${height}`)
}
const video = await render(project, await outputDirectory(project), run, signal)
const metadata = await info(video.path)
const stream = metadata.streams.find(stream => stream.codec_type === 'video')
assert.ok(stream)
assert.equal(stream.codec_name, 'h264')
assert.equal(stream.width, 320)
assert.equal(stream.height, 180)
assert.equal(Number(metadata.format.duration), 1)
assert.equal(Number(metadata.format.size), video.bytes)
const report = { hyperframes: createRequire(import.meta.url)('hyperframes/package.json').version, lint: { valid: valid.ok, invalidErrorCount: findings.errorCount }, sheets, video: { codec: stream.codec_name, width: stream.width, height: stream.height, fps: stream.avg_frame_rate, duration: Number(metadata.format.duration), bytes: video.bytes } }
await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n')
console.log('Native lint, snapshots and MP4 validation passed')
