// Pre-paint theme init — applied before first paint so there's no
// light->dark flash. Kept in sync with src/lib/theme-context.tsx's
// storage key ('atomicqueue.theme') and values ('dark' | 'light').
//
// Served as a same-origin static file (not inline) so it satisfies a
// strict `script-src 'self'` CSP with no 'unsafe-inline', hash, or nonce.
;(function () {
  try {
    var stored = localStorage.getItem('atomicqueue.theme')
    var dark =
      stored === 'dark' ||
      (stored !== 'light' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  } catch (e) {}
})()
