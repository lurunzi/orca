import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'

/** The user's attestation that no agent process holds a session Orca cannot prove free. */
export function StructuredAgentSessionReleaseButton({
  onRelease
}: {
  /** Resolves to an error message, or null once the host released the reservation. */
  onRelease: () => Promise<string | null>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const label = translate('components.native-chat.handoff.release', 'Release session')

  const confirm = (): void => {
    setReleasing(true)
    void onRelease()
      .then((error) => {
        if (error) {
          toast.error(error)
          return
        }
        setOpen(false)
      })
      .finally(() => setReleasing(false))
  }

  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !releasing && setOpen(next)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {translate('components.native-chat.handoff.releaseTitle', 'Release this session?')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'components.native-chat.handoff.releaseDescription',
                "Orca can't confirm that no agent process holds this session. Release it only if no terminal is running it. No process is stopped."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={releasing}>
              {translate('components.native-chat.handoff.cancel', 'Cancel')}
            </Button>
            <Button size="sm" onClick={confirm} disabled={releasing}>
              {releasing ? <Loader2 className="size-4 animate-spin" /> : null}
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
