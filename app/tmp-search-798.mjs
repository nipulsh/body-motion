const url =
  'https://awaited-gelding-3863.accounts.dev/_next/static/chunks/798-a641afd90072af35.js?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF';
const t = await (await fetch(url)).text();
for (const needle of ['hosted-native-auth', 'Hb(', 'native_api', 'redirect_url', 'signUpForce']) {
  let from = 0;
  let n = 0;
  while (n < 2) {
    const i = t.indexOf(needle, from);
    if (i < 0) break;
    console.log('\n====', needle, i);
    console.log(t.slice(Math.max(0, i - 250), i + 400));
    from = i + needle.length;
    n += 1;
  }
}
