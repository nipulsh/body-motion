const html = await (await fetch('https://awaited-gelding-3863.accounts.dev/sign-in')).text();
const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
console.log('scripts', srcs.length);
const needles = ['allowedRedirectProtocols', 'wails:', 'not a valid protocol', 'allowedOrigins'];
for (const src of srcs) {
  const url = src.startsWith('http') ? src : `https://awaited-gelding-3863.accounts.dev${src}`;
  const t = await (await fetch(url)).text();
  const hits = needles.filter((n) => t.includes(n));
  if (hits.length) console.log(src.slice(-90), hits.join(','));
}
