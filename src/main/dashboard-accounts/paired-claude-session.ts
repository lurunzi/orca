import { createConnection, type Socket } from 'node:net'
import { spawnProcess } from '@orca/process-host'
import { retainSubscriptionSession } from './paired-subscription-leases'
import { subscriptionDevice } from './paired-subscription-owner'

export type PairedClaudeSession = {
  sessionId: string
  providerSessionId: string
  configDir: string
  resume: boolean
}
type SubscriptionAdmission = PairedClaudeSession & { version: 1; deviceId: string; cwd: string }

const socketPath = '/run/orca-dashboard/subscription.sock'
const executable = '/usr/local/bin/node'
const unavailable = (): Error => new Error('Paired subscription service unavailable')

// fd 3 already passed the orcad-only handshake. The process has no authority to open another link.
const bridge = `const {Socket}=require('node:net');
const {run}=require('/opt/orca-production-chat/runtime/tenant-launcher.cjs');
const parent=new Socket({fd:4,readable:true,writable:false});
const lost=()=>process.exit(74);
parent.once('end',lost).once('error',lost).resume();
const finish=code=>{parent.removeListener('end',lost);parent.destroy();process.exitCode=code};
run(process.argv.slice(1),process.cwd(),process.stdin,process.stdout,()=>new Socket({fd:3,readable:true,writable:true}))
.then(finish,()=>finish(74))`

function acknowledge(socket: Socket, hello: SubscriptionAdmission): Promise<void> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(fail, 5000)
    function finish(): void {
      clearTimeout(timer)
      socket.off('data', data)
      socket.off('error', fail)
      socket.off('close', fail)
    }
    function fail(): void {
      finish()
      socket.destroy()
      reject(unavailable())
    }
    function data(chunk: Buffer): void {
      size += chunk.length
      if (size > 128) {
        return fail()
      }
      chunks.push(chunk)
      if (!chunk.includes(10)) {
        return
      }
      const bytes = Buffer.concat(chunks)
      if (bytes.indexOf(10) !== bytes.length - 1) {
        return fail()
      }
      try {
        const reply: unknown = JSON.parse(bytes.toString('utf8'))
        if (
          !reply ||
          typeof reply !== 'object' ||
          !('ready' in reply) ||
          reply.ready !== true ||
          Object.keys(reply).length !== 1
        ) {
          return fail()
        }
      } catch {
        return fail()
      }
      socket.pause()
      finish()
      resolve()
    }
    socket.on('data', data)
    socket.once('error', fail)
    socket.once('close', fail)
    socket.write(`${JSON.stringify(hello)}\n`)
  })
}

export async function openPairedClaudeSession(
  session: PairedClaudeSession,
  cwd: string,
  model?: string,
  connect = () => createConnection(socketPath)
) {
  const deviceId = subscriptionDevice()
  const socket = connect()
  // Do not expose socket errors or any untrusted server diagnostic to the SDK.
  socket.on('error', () => {})
  let stopChild: (() => void) | undefined
  const close = (): void => {
    socket.end()
    socket.destroy()
    stopChild?.()
  }
  let release = (): void => {}
  try {
    release = retainSubscriptionSession(session.sessionId, deviceId, close)
    await acknowledge(socket, {
      version: 1,
      deviceId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      configDir: session.configDir,
      resume: session.resume,
      cwd
    })
  } catch (error) {
    release()
    close()
    throw error
  }
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--replay-user-messages',
    ...(model ? ['--model', model] : []),
    session.resume ? '--resume' : '--session-id',
    session.providerSessionId
  ]
  const dispose = (): void => {
    release()
    close()
  }
  const relayArgs = ['-e', bridge, '--', ...args]
  return {
    command: executable,
    args: relayArgs,
    dispose,
    spawn: () => {
      try {
        if (socket.destroyed || socket.writableEnded) {
          throw unavailable()
        }
        const child = spawnProcess({
          program: executable,
          args: relayArgs,
          cwd,
          env: {},
          stdio: ['pipe', 'pipe', 'pipe', socket, 'pipe']
        })
        stopChild = () => {
          child.kill('SIGTERM')
        }
        const stopped = (): void => {
          stopChild = undefined
          release()
          socket.destroy()
        }
        child.once('close', stopped)
        child.once('error', stopped)
        return child
      } catch (error) {
        dispose()
        throw error
      }
    }
  }
}
