const url =
  'https://awaited-gelding-3863.accounts.dev/_next/static/chunks/424-92cfe7b6be6f5562.js?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF';
const t = await (await fetch(url)).text();
const i = t.indexOf('cannot redirect to your application');
console.log(t.slice(Math.max(0, i - 2500), i + 800));
