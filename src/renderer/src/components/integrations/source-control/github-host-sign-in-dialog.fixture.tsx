import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { GitHubHostSignInView } from '@/runtime/source-control/github/github-host-sign-in'
import { GitHubHostSignInDialogView } from './github-host-sign-in-dialog'

function dialogFixture(view: GitHubHostSignInView) {
  return defineFixture({
    width: 560,
    render: () => (
      <div className="h-[420px] bg-background">
        <GitHubHostSignInDialogView
          open
          view={view}
          onOpenPage={() => {}}
          onCancel={() => {}}
          onClose={() => {}}
          onRestart={() => {}}
        />
      </div>
    )
  })
}

export const waiting = dialogFixture({
  phase: 'waiting',
  prompt: { userCode: '9QZ7-K2MX', verificationUri: 'https://github.com/login/device' }
})
export const starting = dialogFixture({ phase: 'starting' })
export const signedIn = dialogFixture({ phase: 'signedIn', login: 'octocat' })
export const failed = dialogFixture({
  phase: 'failed',
  error: 'The sign-in code expired before it was approved. Start again.',
  errorCode: 'expired'
})
export const busy = dialogFixture({
  phase: 'failed',
  error: 'Another GitHub sign-in is already running on this host.',
  busy: true
})
