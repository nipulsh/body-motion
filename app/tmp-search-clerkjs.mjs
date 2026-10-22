const url = 'https://awaited-gelding-3863.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js';
const t = await (await fetch(url)).text();
for (const needle of ['hosted_auth', 'hosted-native-auth', 'native_transfer_nonce', 'native_client_id', '__clerk_hosted_native_auth']) {
  const i = t.indexOf(needle);
  console.log(needle, i);
  if (i >= 0) console.log(t.slice(Math.max(0, i - 180), i + 280));
  console.log('---');
}
