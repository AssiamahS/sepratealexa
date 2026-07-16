// "Alexa, ask my manager what's next" — phase-2 handler.
// Reads tasks.json straight from GitHub raw (same runtime-fetch pattern as
// flashdeck's decks.json), so pushing a new brief updates Alexa instantly.
const Alexa = require('ask-sdk-core');
const https = require('https');

const TASKS_URL =
  'https://raw.githubusercontent.com/AssiamahS/sepratealexa/main/tasks.json';

function fetchTasks() {
  return new Promise((resolve, reject) => {
    https.get(`${TASKS_URL}?t=${Math.floor(Date.now() / 60000)}`, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function speakBrief() {
  const data = await fetchTasks();
  const open = data.tasks.filter(t => !t.done);
  if (!open.length) return 'All clear — everything is checked off today.';
  const top = open.slice(0, 3).map((t, i) => `${i + 1}. ${t.task}`).join('. ');
  return `You have ${open.length} open tasks. Top of the list: ${top}`;
}

const LaunchHandler = {
  canHandle: h => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest',
  async handle(h) {
    const speech = await speakBrief();
    return h.responseBuilder.speak(speech).getResponse();
  },
};

const WhatsNextHandler = {
  canHandle: h =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    Alexa.getIntentName(h.requestEnvelope) === 'WhatsNextIntent',
  async handle(h) {
    const speech = await speakBrief();
    return h.responseBuilder.speak(speech).getResponse();
  },
};

const ErrorHandler = {
  canHandle: () => true,
  handle: h =>
    h.responseBuilder
      .speak("I couldn't reach your task list right now.")
      .getResponse(),
};

exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(LaunchHandler, WhatsNextHandler)
  .addErrorHandlers(ErrorHandler)
  .lambda();
