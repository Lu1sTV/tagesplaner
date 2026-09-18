// Startet UI und API zusammen, damit `pnpm dev` alles hochzieht.
// Stirbt einer der Prozesse, geht der andere mit.
import { spawn } from 'node:child_process'

const jobs = [
  {
    name: 'api',
    cmd: process.execPath,
    args: ['--watch', 'server/index.mjs'],
    env: { TODO_PASSWORD: process.env.TODO_PASSWORD ?? 'dev' },
  },
  { name: 'ui', cmd: 'node_modules/.bin/vite', args: [], env: {} },
]

const width = Math.max(...jobs.map((j) => j.name.length))
let shuttingDown = false

const children = jobs.map((job) => {
  const child = spawn(job.cmd, job.args, {
    env: { ...process.env, ...job.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const prefix = `[${job.name.padEnd(width)}] `
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => {
      const lines = String(chunk).replace(/\n$/, '').split('\n')
      for (const line of lines) out.write(prefix + line + '\n')
    })
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)

  child.on('exit', (code) => {
    if (shuttingDown) return
    console.log(`${prefix}beendet (Code ${code}) – fahre alles herunter.`)
    stop(code ?? 0)
  })
  return child
})

function stop(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 200)
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

console.log('UI auf http://localhost:5180 – API auf http://localhost:3000 (Passwort: dev)')
