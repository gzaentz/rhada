// Speech typed into the panel's box by Chrome's own on-device recognizer.
// Audio never leaves the computer: recognition runs only with processLocally,
// and a browser that will not promise that is refused. There is no fallback to
// a speech service. Without the on-device API the mic is not shown; where
// Chrome has no local model for the language, the first press says so and the
// mic goes away. The language is checked, and if needed downloaded, only on
// that first press, because asking can crash some Chromium builds.

export const PROBLEMS = {
  blocked: 'To speak, allow Gmail to use your microphone.',
  noMicrophone: 'No microphone found. Connect one, or type instead.',
  noSpeech: 'Nothing heard. Press the mic and speak.',
  unavailable: "Voice isn't available in this browser. Type instead.",
  failed: 'Voice stopped. Press the mic to try again.',
  unfinished: 'Check the words, then press Enter.',
};

// How long Enter waits for the last words; after that they stay in the box to check.
const FINISH_MS = 2000;
// How strongly the recognizer leans toward a listed name (0 to 10), and how many.
// Measured in Chrome's on-device recognizer on 2026-11-08 for the Leadpoet app.
const NAME_BOOST = 2;
const MAX_NAMES = 64;

// The recognizer, under either name, when it has the on-device API. Looked up
// when a panel opens, not when the script loads.
export function localRecognizer(scope = globalThis) {
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    const candidate = scope[name];
    if (typeof candidate !== 'function') continue;
    if (typeof candidate.available === 'function' && typeof candidate.install === 'function' && 'processLocally' in candidate.prototype) {
      return candidate;
    }
  }
  return null;
}

// The recognizer's phrases as one text, with a space where a phrase brings none.
export const joinPhrases = (phrases) =>
  phrases.reduce((text, phrase) => (text === '' || /\s$/.test(text) || /^\s/.test(phrase) ? text + phrase : `${text} ${phrase}`), '');

// What was typed, then what was heard.
export function joinDictation(typed, heard) {
  const words = heard.replace(/\s+/g, ' ').trim();
  if (!words) return typed;
  return typed + (typed === '' || /\s$/.test(typed) ? '' : ' ') + words;
}

function problemFor(error) {
  if (error === 'aborted') return null;
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'blocked';
  if (error === 'audio-capture') return 'noMicrophone';
  if (error === 'no-speech') return 'noSpeech';
  if (error === 'language-not-supported') return 'unavailable';
  return 'failed';
}

// state: hidden | idle | preparing | listening. onUpdate runs on every change.
export function createDictation({ lang, names = [], getText, setText, onUpdate }) {
  const Recognizer = localRecognizer();
  const Phrase = Recognizer && typeof globalThis.SpeechRecognitionPhrase === 'function' ? globalThis.SpeechRecognitionPhrase : null;
  let state = Recognizer ? 'idle' : 'hidden';
  let problem = null;
  let ready = false; // the language model is on this device
  let namesRefused = false;
  let session = null;
  let attempt = 0; // bumped by every start and cancel, so a late setup starts nothing
  let finishing = null; // Enter pressed while speaking, waiting for the last words
  let written = '';

  const update = (next, nextProblem = problem) => {
    state = next;
    problem = nextProblem;
    onUpdate();
  };
  const fail = (key) => update(key === 'unavailable' ? 'hidden' : 'idle', PROBLEMS[key]);

  // Names the writer is likely to say, so the recognizer hears them right.
  function hint(recognition) {
    if (!Phrase || namesRefused) return false;
    const seen = new Set();
    const phrases = [];
    for (const raw of names) {
      const name = String(raw).replace(/\s+/g, ' ').trim();
      if (!name || seen.has(name.toLowerCase()) || phrases.length === MAX_NAMES) continue;
      seen.add(name.toLowerCase());
      try {
        phrases.push(new Phrase(name, NAME_BOOST));
      } catch {
        // Left out; the rest still help.
      }
    }
    if (!phrases.length) return false;
    try {
      recognition.phrases = phrases;
      return true;
    } catch {
      return false;
    }
  }

  function listen() {
    const typed = getText();
    written = typed;
    const begin = (withNames) => {
      const recognition = new Recognizer();
      recognition.lang = lang;
      recognition.processLocally = true;
      // A browser that ignores the setting could send audio to a server: refuse it.
      if (recognition.processLocally !== true) {
        fail('unavailable');
        return;
      }
      recognition.continuous = true;
      recognition.interimResults = true;
      const hinted = withNames && hint(recognition);
      recognition.onresult = (event) => {
        if (session !== recognition) return;
        const phrases = [];
        for (let i = 0; i < event.results.length; i += 1) phrases.push(event.results[i][0].transcript);
        written = joinDictation(typed, joinPhrases(phrases));
        setText(written);
      };
      recognition.onerror = (event) => {
        if (session !== recognition) return;
        // A recognizer that cannot take names refuses them as it starts: listen again without.
        if (hinted && event.error === 'phrases-not-supported') {
          namesRefused = true;
          if (!finishing) {
            session = null;
            recognition.abort();
            begin(false);
            return;
          }
        }
        const key = problemFor(event.error);
        if (!key) return;
        const shown = finishing ? 'unfinished' : key;
        finishing?.settle(null);
        if (key === 'unavailable') {
          session = null;
          recognition.abort();
          update('hidden', PROBLEMS[key]);
        } else {
          update(state, PROBLEMS[shown]);
        }
      };
      recognition.onend = () => {
        if (session !== recognition) return;
        session = null;
        update('idle');
        finishing?.settle(written);
      };
      session = recognition;
      try {
        recognition.start();
        update('listening', null);
      } catch {
        session = null;
        fail('failed');
      }
    };
    begin(true);
  }

  // Stops listening and drops speech still being heard. What is in the box stays.
  function cancel() {
    attempt += 1;
    const recognition = session;
    session = null;
    finishing?.settle(null);
    recognition?.abort();
    update(state === 'hidden' ? 'hidden' : 'idle', null);
  }

  // Start listening, or stop and keep what was heard.
  function toggle() {
    if (state === 'hidden' || state === 'preparing') return;
    if (state === 'listening') {
      session?.stop();
      return;
    }
    const mine = ++attempt;
    if (ready) {
      problem = null;
      listen();
      return;
    }
    const options = { langs: [lang], processLocally: true };
    update('preparing', null);
    Promise.resolve()
      .then(() => Recognizer.available(options))
      .then((status) =>
        status === 'downloadable' || status === 'downloading'
          ? Recognizer.install(options).then((installed) => (installed ? Recognizer.available(options) : 'unavailable'))
          : status,
      )
      .catch(() => 'unavailable')
      .then((status) => {
        if (status === 'available') ready = true;
        if (attempt !== mine) return;
        if (status === 'available') listen();
        else fail('unavailable');
      });
  }

  // Stops listening and waits for the last, corrected words. Resolves with the
  // box as speech left it, or null when listening ended any other way first.
  function finish() {
    const recognition = session;
    if (!recognition) return Promise.resolve(getText());
    if (finishing?.recognition === recognition) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cancel();
        update(state, PROBLEMS.unfinished);
      }, FINISH_MS);
      const entry = {
        recognition,
        settle(text) {
          clearTimeout(timer);
          if (finishing === entry) finishing = null;
          resolve(text);
        },
      };
      finishing = entry;
      recognition.stop();
    });
  }

  return {
    get state() {
      return state;
    },
    get problem() {
      return problem;
    },
    toggle,
    cancel,
    finish,
    // A problem stays until the writer types, sends or tries the mic again.
    clearProblem() {
      if (!session && problem) update(state, null);
    },
  };
}
