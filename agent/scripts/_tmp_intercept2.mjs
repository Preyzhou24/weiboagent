(async () => {
  const log = [];
  const origFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const opt = args[1] || {};
    log.push({ type: 'fetch', url, method: opt.method || 'GET', body: opt.body ? String(opt.body).slice(0,400) : '' });
    return origFetch.apply(this, args);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._wxMethod = method;
    this._wxUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._wxMethod && /POST|post/.test(this._wxMethod)) {
      log.push({ type: 'xhr', url: this._wxUrl, method: this._wxMethod, body: body ? String(body).slice(0,400) : '' });
    }
    return origSend.call(this, body);
  };
  const btn = document.querySelector('article button.woo-like-main') || document.querySelector('button.woo-like-main');
  if (!btn) return JSON.stringify({ err: 'no like button', url: location.href });
  const before = btn.querySelector('.woo-like-count')?.textContent?.trim() || '';
  btn.click();
  await new Promise(r => setTimeout(r, 3000));
  const after = btn.querySelector('.woo-like-count')?.textContent?.trim() || '';
  return JSON.stringify({ before, after, captured: log, url: location.href });
})()
