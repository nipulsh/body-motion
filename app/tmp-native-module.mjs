const manifestUrl =
  'https://awaited-gelding-3863.accounts.dev/_next/static/QsJl116c8pKuIUMBkV298/_buildManifest.js?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF';
const manifest = await (await fetch(manifestUrl)).text();
const i = manifest.indexOf('hosted-native-auth');
console.log(manifest.slice(Math.max(0, i - 400), i + 250));

const html = await (await fetch('https://awaited-gelding-3863.accounts.dev/hosted-native-auth/complete')).text();
const srcs = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
for (const src of srcs) {
  const url = src.startsWith('http') ? src : `https://awaited-gelding-3863.accounts.dev${src}`;
  const t = await (await fetch(url)).text();
  if (!t.includes('Hosted native auth could not find')) continue;
  console.log('found helper in', src.slice(-80), 'but message is in complete page');
}
// search all scripts for the error string's sibling helpers
for (const src of srcs) {
  const url = src.startsWith('http') ? src : `https://awaited-gelding-3863.accounts.dev${src}`;
  const t = await (await fetch(url)).text();
  if (t.includes('redirectUrl') && t.includes('createdSessionId') && t.includes('3552')) {
    console.log('candidate', src.slice(-100));
  }
  const marker = 'Hosted native auth';
  if (t.includes(marker) && !src.includes('complete-f0f601')) {
    console.log('other', src.slice(-80));
  }
}

// The complete chunk imports n(3552). Find which file defines 3552:function
for (const src of srcs) {
  const url = src.startsWith('http') ? src : `https://awaited-gelding-3863.accounts.dev${src}`;
  const t = await (await fetch(url)).text();
  if (t.includes('3552:function') || t.includes('createdSessionId') && t.includes('custom scheme')) {
    console.log('DEF', src.slice(-120));
  }
}
