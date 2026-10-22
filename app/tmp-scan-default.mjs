const html = await (await fetch('https://awaited-gelding-3863.accounts.dev/sign-in')).text();
const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
const page = await (await fetch('https://awaited-gelding-3863.accounts.dev/default-redirect')).text();
const pageSrcs = [...page.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
const all = [...new Set([...srcs, ...pageSrcs])];
console.log('files', all.length);
for (const src of all) {
  const url = src.startsWith('http') ? src : `https://awaited-gelding-3863.accounts.dev${src}`;
  const t = await (await fetch(url)).text();
  if (t.includes('default-redirect') || t.includes('DefaultRedirect')) {
    console.log('\nFILE', src.slice(-100), 'len', t.length);
    const i = t.indexOf('DefaultRedirect');
    const j = t.indexOf('default-redirect');
    const at = i >= 0 ? i : j;
    console.log(t.slice(Math.max(0, at - 200), at + 600));
  }
}
