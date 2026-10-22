const url =
  'https://awaited-gelding-3863.accounts.dev/_next/static/chunks/798-a641afd90072af35.js?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF';
const t = await (await fetch(url)).text();
const i = t.indexOf('__clerk_native_client_id');
console.log(t.slice(Math.max(0, i - 200), i + 4500));
