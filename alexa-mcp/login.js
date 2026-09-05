// One-time Amazon login capture. Run: node login.js
// Starts a local proxy; open the printed URL (phone or Mac), log in to Amazon,
// and the session cookie + registration data land in data/cookie.json.
// alexa-cookie2 calls back FIRST with a "please open the URL" error while the
// proxy waits, then again after a successful login — so we only exit on
// success, a real error, or the 10-minute timeout.
const Alexa = require('alexa-remote2');
const { baseOptions, saveCookie, COOKIE_FILE, loginUrl } = require('./client');

console.log('[login] starting Amazon login proxy...');
console.log(`[login] OPEN THIS URL AND LOG IN: ${loginUrl}`);

const timeout = setTimeout(() => {
  console.error('[login] timed out after 10 minutes without a login.');
  process.exit(1);
}, 10 * 60 * 1000);

const alexa = new Alexa();
let cookieSaved = false;

alexa.on('cookie', () => {
  if (alexa.cookieData && !cookieSaved) {
    cookieSaved = true;
    saveCookie(alexa.cookieData);
    console.log(`[login] cookie captured and saved to ${COOKIE_FILE}`);
  }
});

alexa.init(baseOptions((m) => console.log(`[alexa] ${m}`)), (err) => {
  if (err) {
    const msg = String(err.message || err);
    if (msg.includes('Please open')) {
      console.log(`[login] proxy is up — waiting for you to sign in at ${loginUrl}`);
      return; // keep process alive; init continues after the browser login
    }
    if (!cookieSaved) {
      clearTimeout(timeout);
      console.error(`[login] FAILED: ${msg}`);
      process.exit(1);
    }
    return;
  }
  clearTimeout(timeout);
  const devices = Object.values(alexa.serialNumbers || {})
    .filter((d) => d.accountName)
    .map((d) => d.accountName);
  console.log(`[login] SUCCESS — authenticated. Devices: ${devices.join(', ') || '(none listed)'}`);
  setTimeout(() => process.exit(0), 500);
});
