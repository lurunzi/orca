import { describe, expect, it, vi } from 'vitest'
import { createPageBackConsumers } from './page-back-consumers'

function consumers() {
  const claims: boolean[] = []
  const unclaimed = vi.fn()
  return {
    claims,
    unclaimed,
    stack: createPageBackConsumers({
      onClaimedChange: (claimed) => claims.push(claimed),
      onUnclaimed: unclaimed
    })
  }
}

describe('who in the page is holding the device Back key', () => {
  it('tells the shell on the edges only, so one sheet over another does not flicker the key', () => {
    const { claims, stack } = consumers()
    const first = stack.claim(() => true)
    const second = stack.claim(() => true)
    expect(claims).toEqual([true])
    second()
    expect(claims).toEqual([true])
    first()
    expect(claims).toEqual([true, false])
  })

  it('offers a press newest first, and stops at the one that takes it', () => {
    const { stack } = consumers()
    const order: string[] = []
    stack.claim(() => {
      order.push('bottom')
      return true
    })
    stack.claim(() => {
      order.push('top')
      return true
    })
    stack.press()
    expect(order).toEqual(['top'])
  })

  it('falls through a consumer that says the press was not its own', () => {
    const { stack, unclaimed } = consumers()
    const order: string[] = []
    stack.claim(() => {
      order.push('bottom')
      return true
    })
    stack.claim(() => {
      order.push('top')
      return false
    })
    stack.press()
    expect(order).toEqual(['top', 'bottom'])
    expect(unclaimed).not.toHaveBeenCalled()
  })

  /**
   * The claim and the press cross on separate frames, so a sheet that closed between the two leaves
   * the shell holding a claim this page cannot spend. Dropping the press there is the failure this
   * whole lane exists to remove: the key would do nothing at all.
   */
  it('hands a press nothing took back to the shell rather than dropping it', () => {
    const { stack, unclaimed } = consumers()
    stack.press()
    expect(unclaimed).toHaveBeenCalledTimes(1)
    const release = stack.claim(() => false)
    stack.press()
    expect(unclaimed).toHaveBeenCalledTimes(2)
    release()
  })

  it('survives a consumer that disposes itself from inside its own answer', () => {
    const { stack } = consumers()
    const order: string[] = []
    stack.claim(() => {
      order.push('bottom')
      return true
    })
    const release = stack.claim(() => {
      order.push('top')
      release()
      return false
    })
    stack.press()
    // The one beneath it still hears the press: the walk is over a copy, so the splice inside the
    // top consumer cannot skip it.
    expect(order).toEqual(['top', 'bottom'])
  })

  it('ignores a release called twice, so a remounting claim cannot free another one', () => {
    const { claims, stack } = consumers()
    const release = stack.claim(() => true)
    release()
    const other = stack.claim(() => true)
    release()
    expect(claims).toEqual([true, false, true])
    other()
    expect(claims).toEqual([true, false, true, false])
  })

  it('gives the key back when the client closes, whoever was still holding it', () => {
    const { claims, stack } = consumers()
    stack.claim(() => true)
    stack.claim(() => true)
    stack.clear()
    expect(claims).toEqual([true, false])
    // And says nothing a second time: there is nothing left to give back.
    stack.clear()
    expect(claims).toEqual([true, false])
  })
})
