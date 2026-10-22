const url =
  'https://awaited-gelding-3863.accounts.dev/_next/static/chunks/pages/_app-aa1762686ea52c08.js?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF';
const t = await (await fetch(url)).text();
for (const needle of ['allowedRedirectProtocols', 'allowedOrigins', 'signUpForceRedirectUrl', 'after_sign_up_url']) {
  let from = 0;
  let n = 0;
  while (n < 3) {
    const i = t.indexOf(needle, from);
    if (i < 0) break;
    console.log('\n====', needle, i, '====');
    console.log(t.slice(Math.max(0, i - 350), i + 450));
    from = i + needle.length;
    n += 1;
  }
}
