(async () => {
  const mid = '5328860125073555';
  const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  if (!xsrfMatch) return JSON.stringify({ err: 'no xsrf' });
  const xsrf = decodeURIComponent(xsrfMatch[1]);

  // Test 1: with id only, no fp
  const fd1 = new URLSearchParams();
  fd1.append('id', mid);
  const r1 = await fetch('/ajax/statuses/setLike', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-XSRF-TOKEN': xsrf, 'Accept': 'application/json, text/plain, */*' },
    body: fd1.toString(),
    credentials: 'include',
  });
  const t1 = await r1.text();

  // Test 2: with id + empty fp
  const fd2 = new URLSearchParams();
  fd2.append('id', mid);
  fd2.append('fp', '');
  const r2 = await fetch('/ajax/statuses/setLike', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-XSRF-TOKEN': xsrf, 'Accept': 'application/json, text/plain, */*' },
    body: fd2.toString(),
    credentials: 'include',
  });
  const t2 = await r2.text();

  return JSON.stringify({ test1_no_fp: { status: r1.status, body: t1.slice(0,300) }, test2_empty_fp: { status: r2.status, body: t2.slice(0,300) } });
})()
