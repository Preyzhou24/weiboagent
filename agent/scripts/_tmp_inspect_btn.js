(() => {
  const t = document.querySelector('textarea._input_1fox3_8');
  if (!t) return JSON.stringify({ error: 'no textarea' });
  let el = t.parentElement.parentElement.parentElement;
  const btn = el.querySelector('button');
  if (!btn) return JSON.stringify({ error: 'no button' });
  const r = btn.getBoundingClientRect();
  return JSON.stringify({
    text: btn.innerText,
    disabled: btn.disabled,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    visible: r.width > 0 && r.height > 0
  });
})()
