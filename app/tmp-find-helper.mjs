const files = [
  'static/chunks/694-8fe6b8c36ea6b07b.js',
  'static/chunks/798-a641afd90072af35.js',
  'static/chunks/658-576c850810db59b6.js',
  'static/chunks/pages/sign-in/[[...index]]-681c5565c150c695.js',
  'static/chunks/pages/hosted-native-auth/complete-f0f601f747e6d768.js',
];
const base = 'https://awaited-gelding-3863.accounts.dev/_next/';
for (const file of files) {
  const t = await (await fetch(base + file + '?dpl=dpl_8Yk9mFr6KgYEb725UoWw7jkCV6hF')).text();
  console.log(file, t.length, 'createdSession', t.includes('createdSessionId'), '3552', t.includes('3552:function'));
  if (t.includes('3552:function') || (t.includes('createdSessionId') && t.includes('redirectUrl') && !file.includes('complete'))) {
    const i = t.indexOf('createdSessionId');
    console.log(t.slice(Math.max(0, i - 400), i + 900));
  }
}
