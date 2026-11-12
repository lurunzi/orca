import { useEffect, useId, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { callAntigravityChatFullAccessApprovals } from '@/runtime/provider-accounts/sign-in/runtime-antigravity-accounts-client'
import { useStructuredAgentSessionHostCapabilityState } from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-capability'
import { ANTIGRAVITY_CHAT_FULL_ACCESS_APPROVALS_RUNTIME_CAPABILITY } from '../../../../shared/account-runtime-capabilities'
import {
  resolveAntigravityChatFullAccessApprovals,
  type AntigravityChatFullAccessApprovals
} from '../../../../shared/antigravity-chat-full-access-approvals'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { AntigravityChatAuthSettingRow } from './AntigravityChatAuthSettingRow'

/** Who answers tool approvals in Full access chats on the host's agy; read and saved on that host. */
export function AntigravityChatFullAccessApprovalsSetting({
  owner
}: {
  owner: RuntimeClientTarget
}): React.JSX.Element | null {
  const t = useTranslate()
  const id = useId()
  const capability = useStructuredAgentSessionHostCapabilityState(
    owner,
    ANTIGRAVITY_CHAT_FULL_ACCESS_APPROVALS_RUNTIME_CAPABILITY
  )
  const environmentId = owner.kind === 'environment' ? owner.environmentId : null
  const [value, setValue] = useState<AntigravityChatFullAccessApprovals | null>(null)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (capability !== 'supported') {
      return
    }
    let current = true
    const target: RuntimeClientTarget =
      environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }
    void callAntigravityChatFullAccessApprovals(target).then(
      (next) => current && setValue(resolveAntigravityChatFullAccessApprovals(next)),
      () => current && setFailed(true)
    )
    return () => {
      current = false
    }
  }, [capability, environmentId])
  if (capability !== 'supported') {
    return null
  }
  const save = (next: AntigravityChatFullAccessApprovals): void => {
    setPending(true)
    setFailed(false)
    void callAntigravityChatFullAccessApprovals(owner, next)
      .then((saved) => setValue(resolveAntigravityChatFullAccessApprovals(saved)))
      .catch(() => setFailed(true))
      .finally(() => setPending(false))
  }
  return (
    <div className="space-y-2">
      <AntigravityChatAuthSettingRow
        htmlFor={id}
        label={t('accounts.antigravity.fullAccessApprovals', 'Full access approvals')}
        description={
          value === 'agent'
            ? t(
                'accounts.antigravity.fullAccessApprovalsAgentDescription',
                'agy approves tools itself. Plan approvals and questions still reach you.'
              )
            : t(
                'accounts.antigravity.fullAccessApprovalsOrcaDescription',
                'Orca approves tools. Plan approvals, questions and security warnings still reach you.'
              )
        }
      >
        <Select
          value={value ?? undefined}
          disabled={value === null || pending}
          onValueChange={(next) => save(resolveAntigravityChatFullAccessApprovals(next))}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="orca">
              {t('accounts.antigravity.fullAccessApprovalsOrca', 'Orca')}
            </SelectItem>
            <SelectItem value="agent">
              {t('accounts.antigravity.fullAccessApprovalsAgent', 'Agent (agy)')}
            </SelectItem>
          </SelectContent>
        </Select>
      </AntigravityChatAuthSettingRow>
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t(
            'accounts.antigravity.fullAccessApprovalsFailed',
            "Orca couldn't read or save this setting. Try again."
          )}
        </p>
      )}
    </div>
  )
}
