// Detects UTF-8 text that a Windows shell decoded in the GBK (CP936) ANSI
// code page before handing it to the CLI, e.g. Windows PowerShell 5.1
// `Get-Content` without `-Encoding UTF8` on a BOM-less file. The damage is
// lossy (odd trailing bytes become "?"), so the CLI refuses instead of repairing.
//
// Chinese full-width punctuation is the reliable tell: `，：；（）` (EF BC xx)
// decode to 锛, `、。「」《》` (E3 80 xx) to 銆, `“”‘’—…` (E2 80 xx) to 鈥, and
// any 0x80 continuation byte after a GBK lead byte shows up as "€" glued to a
// Han character. Genuine Chinese almost never contains these.
const GBK_MOJIBAKE_MARKER = /[锛銆鈥]|[一-鿿]€/gu
const MIN_MARKERS = 3

export function looksLikeGbkDecodedUtf8(text: string): boolean {
  let count = 0
  for (const _ of text.matchAll(GBK_MOJIBAKE_MARKER)) {
    count += 1
    if (count >= MIN_MARKERS) {
      return true
    }
  }
  return false
}
