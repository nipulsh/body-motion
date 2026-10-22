const manifestUrl =
  'https://awaited-gelding-3863.accounts.dev/_next/static/QsJl116c8pKuIUMBkV298/_buildManifest.js?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF';
const manifest = await (await fetch(manifestUrl)).text();
console.log(manifest.slice(0, 1800));
