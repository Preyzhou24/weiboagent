(async () => {
  const targetUid = '2803301701';
  const xsrfM = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  if (!xsrfM) return JSON.stringify({ err: 'no xsrf' });
  const xsrf = decodeURIComponent(xsrfM[1]);

  // Weibo web follow endpoint. Field name must be `uid`.
  const fd = new URLSearchParams();
  fd.append('uid', targetUid);
  fd.append('lf', 'follow');
  fd.append('refer_flag', 'profile_headerv8');
  fd.append('_t', 'all');

  const r = await fetch('/ajax/friendships/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-XSRF-TOKEN': xsrf,
      'Referer': 'https://weibo.com/u/' + targetUid,
      'Accept': 'application/json, text/plain, */*',
    },
    body: fd.toString(),
    credentials: 'include',
  });
  const t = await r.text();
  return JSON.stringify({ status: r.status, body: t.slice(0, 300) });
})()
