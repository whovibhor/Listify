// Applies the saved theme before first paint to avoid a light/dark flash (see theme-provider.tsx).
// A separate file rather than inline, so a Content-Security-Policy can forbid inline scripts.
try {
  var t = localStorage.getItem('listify-theme')
  var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
} catch (e) {}
