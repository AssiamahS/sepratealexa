// Shared Alexa connection for login.js and server.js.
// Cookie/registration data persists in data/cookie.json and auto-refreshes;
// only the first login (or an expired refresh token) needs the browser proxy.
const fs = require('fs');
const path = require('path');
const Alexa = require('alexa-remote2');

const DATA_DIR = path.join(__dirname, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookie.json');

const PROXY_IP = process.env.ALEXA_PROXY_IP || '100.97.199.99'; // Tailscale IP so the phone can reach the login page
const PROXY_PORT = 3456;

function loadCookie() {
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveCookie(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
}

function baseOptions(logger) {
  return {
    proxyOnly: true,
    setupProxy: true,
    proxyOwnIp: PROXY_IP,
    proxyPort: PROXY_PORT,
    proxyListenBind: '0.0.0.0',
    proxyLogLevel: 'warn',
    amazonPage: 'amazon.com',
    amazonPageProxyLanguage: 'en_US',
    acceptLanguage: 'en-US',
    alexaServiceHost: 'alexa.amazon.com',
    cookieRefreshInterval: 4 * 24 * 60 * 60 * 1000,
    useWsMqtt: false,
    bluetooth: false,
    logger,
  };
}

// Resolves with a ready Alexa instance, or rejects if no valid cookie.
// onProxyStarted (login flow only) fires once the proxy URL is live.
function connect({ logger, requireCookie = true } = {}) {
  return new Promise((resolve, reject) => {
    const cookie = loadCookie();
    if (requireCookie && !cookie) {
      return reject(new Error('NO_COOKIE'));
    }
    const alexa = new Alexa();
    alexa.on('cookie', () => {
      if (alexa.cookieData) saveCookie(alexa.cookieData);
    });
    const options = baseOptions(logger);
    if (cookie) options.cookie = cookie;
    alexa.init(options, (err) => {
      if (err) return reject(err);
      resolve(alexa);
    });
  });
}

module.exports = {
  connect,
  baseOptions,
  loadCookie,
  saveCookie,
  COOKIE_FILE,
  PROXY_IP,
  PROXY_PORT,
  loginUrl: `http://${PROXY_IP}:${PROXY_PORT}/`,
};
