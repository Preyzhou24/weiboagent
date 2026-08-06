(async () => {
  const log = [];
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const opt = args[1] || {};
    if (opt.method === 'POST' || opt.method === 'post') {
      log.push({ url, method: opt.method, body: opt.body ? String(opt.body).slice(0,300) : '' });
    }
    return origFetch.apply(this, args);
  };
  const btn = document.querySelector('article button.woo-like-main') || document.querySelector('button.woo-like-main');
  if (!btn) return JSON.stringify({ err: 'no like button', url: location.href });
  const before = btn.querySelector('.woo-like-count')?.textContent?.trim() || '';
  btn.click();
  await new Promise(r => setTimeout(r, 3000));
  const after = btn.querySelector('.woo-like-count')?.textContent?.trim() || '';
  return JSON.stringify({ before, after, captured: log, url: location.href });
})()
