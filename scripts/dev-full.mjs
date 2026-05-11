// ===========================================================================
// Запускает сервер и Vite параллельно в одном процессе. Когда Ctrl+C —
// гасит оба чайлда. Это минимальный замена concurrently/npm-run-all, чтобы
// не тащить лишнюю dev-зависимость.
// ===========================================================================

import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'

function run(name, cmd, args, color) {
  const child = spawn(cmd, args, { shell: isWin, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`
  const pipe = (stream, target) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line) target.write(`${prefix} ${line}\n`)
      }
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code ?? 0}`)
    process.exit(code ?? 0)
  })
  return child
}

const server = run('server', 'node', ['server/index.js'], '36')
const vite = run('vite', 'npx', ['vite'], '35')

function stop() {
  try { server.kill() } catch { void 0 }
  try { vite.kill() } catch { void 0 }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
