/** Fork: reads again up to `retries` times while `retryable` says a miss may still resolve; returns a stop. */
export function readLocalImageWithRetry(
  read: () => Promise<string | null>,
  retries: number,
  hooks: {
    cancelled: () => boolean
    retryable: (url: string | null) => boolean
    settle: (url: string | null) => void
  }
): () => void {
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const load = (): void => {
    void read()
      .catch(() => null)
      .then((url) => {
        if (hooks.cancelled()) {
          return
        }
        if (attempt < retries && hooks.retryable(url)) {
          attempt += 1
          timer = setTimeout(load, attempt * 250)
          return
        }
        hooks.settle(url)
      })
  }
  load()
  return () => clearTimeout(timer)
}
