(async () => {
  const mid = '5328860125073555';
  const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  if (!xsrfMatch) return JSON.stringify({ err: 'no xsrf' });
  const xsrf = decodeURIComponent(xsrfMatch[1]);
  const fd = new URLSearchParams();
  fd.append('id', mid);
  fd.append('location', 'page_100505_home');
  const r = await fetch('/ajax/favorites/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-XSRF-TOKEN': xsrf,
      'Accept': 'application/json, text/plain, */*',
    },
    body: fd.toString(),
    credentials: 'include',
  });
  const t = await r.text();
  return JSON.stringify({ status: r.status, body: t.slice(0, 400), url: location.href, xsrf: 'yes' });
})()
