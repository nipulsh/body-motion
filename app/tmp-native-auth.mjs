const pageUrl = 'https://awaited-gelding-3863.accounts.dev/hosted-native-auth/complete';
const page = await (await fetch(pageUrl)).text();
console.log('page len', page.length);
const srcs = [...page.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
console.log(srcs.map((s) => s.slice(-120)).join('\n'));
for (const src of srcs) {
  if (!src.includes('hosted-native') && !src.includes('complete')) continue;
  const url = src.startsWith('http') ? src : `https://awaited-gelding-3863.accounts.dev${src}`;
  const t = await (await fetch(url)).text();
  console.log('\n====', src.slice(-140), t.length);
  const i = t.indexOf('hosted-native');
  console.log(t.slice(Math.max(0, i - 100), Math.min(t.length, i + 1500)));
}
