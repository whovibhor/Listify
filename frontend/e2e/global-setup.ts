import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** Migrates and empties the test database so every run starts from a known state. */
export default function globalSetup() {
  const backendDir = path.resolve(import.meta.dirname, '../../backend')
  const python =
    process.platform === 'win32'
      ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
      : path.join(backendDir, '.venv', 'bin', 'python')
  execFileSync(python, ['-m', 'scripts.reset_test_db'], { cwd: backendDir, stdio: 'inherit' })
}
