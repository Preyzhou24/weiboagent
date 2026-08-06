(async () => {
  const btns = [...document.querySelectorAll('button,a,div')].filter(b => {
    const t = b.textContent.trim();
    return t === '关注' || t === '加关注' || t === '已关注';
  });
  const info = btns.slice(0, 5).map(b => ({
    text: b.textContent.trim(),
    tag: b.tagName,
    cls: (b.className || '').slice(0, 60),
    parent: b.parentElement ? b.parentElement.className.slice(0, 40) : '',
  }));
  const html = document.documentElement.innerHTML;
  const uidM = html.match(/\D(2803301701)\D/);
  const ogTitle = document.querySelector('meta[property="og:title"]');
  return JSON.stringify({
    url: location.href,
    count: btns.length,
    info,
    uidInPage: uidM ? uidM[1] : null,
    ogTitle: ogTitle ? ogTitle.content : null,
  });
})()
