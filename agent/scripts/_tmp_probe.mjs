(async () => {
  // Probe the follow button on a profile page and what endpoint it would hit.
  // First ensure we are on a real profile page.
  const btns = [...document.querySelectorAll('button,a,div')].filter(b => {
    const t = b.textContent.trim();
    return t === '关注' || t === '加关注' || t === '已关注';
  });
  const info = btns.slice(0, 8).map(b => ({
    text: b.textContent.trim(),
    tag: b.tagName,
    cls: (b.className || '').slice(0, 60),
    href: b.href || '',
  }));
  // Try to read any data-* attributes
  const dataAttrs = btns.slice(0, 4).map(b => {
    const da = {};
    for (const a of b.attributes || []) { if (a.name.startsWith('data-')) da[a.name] = a.value; }
    return { text: b.textContent.trim(), da };
  });
  return JSON.stringify({ url: location.href, count: btns.length, info, dataAttrs });
})()
