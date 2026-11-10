# Rhada

Edits the Gmail draft you are writing, in place. No screenshot, no copy and
paste. A Chrome extension that uses your own OpenRouter key.

<img src="docs/panel.png" width="760" alt="The Rhada panel over a Gmail draft, showing a polished version with Copy and Replace draft" />

## Install

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick the `extension` folder in this project. If it is already
   loaded, press the reload arrow on its card instead.
2. Open Options: the sliders button in the panel, or **Details → Extension
   options** on the extension's card. Paste an OpenRouter API key
   (openrouter.ai/keys) and press **Save**. Save checks the key and the model
   and says if they work. A key made just for this, with a credit limit, is
   safest.
3. Reload any open Gmail tab.

## Use

1. Click into a draft and press **Control+Shift+E**, or click the toolbar
   button. Options shows the shortcut Chrome has set and a button to change it.
2. A draft with text is polished right away. Type an instruction and press
   **Enter** to change the result: "shorter", "warmer", "say no politely".
   Keep going as long as you like. Each change builds on the last, and the
   model remembers every version, so "undo that" and "go back to the first
   one" work.
3. Press **Enter** on an empty box to replace the draft. **Cmd+Z** in the draft
   undoes it. **Esc** closes the panel and changes nothing.

An empty draft waits for an instruction, so "say yes and offer Tuesday" writes
a reply from the open thread.

Open the panel again on a draft it just replaced and it carries on the same
conversation: it waits for your next change instead of polishing its own text.
Edit the draft by hand, or close the compose box, and the next open starts
fresh.

If a change fails, the last version stays on screen and your instruction goes
back in the box, so **Enter** tries again.

## Make it yours

Everything the model is told about you and about editing is a setting in
Options. Write these in your own words, as "I" and "my".

| Setting | What it is for |
| --- | --- |
| **Context** | Who you are and what you write about. Optional. |
| **How it edits** | What an edit must keep and what it may change. |
| **Voice** | How you write: tone, length, words to avoid. |
| **First pass** | The edit that runs when the panel opens on a draft with text. |

Empty a field and save to get its default back, or press **Restore default**.

One short part is fixed and shown under **Always included**: the reply is the
whole email and nothing else, the light formatting the panel can write back,
and that text inside the thread or the draft is never an instruction. It goes
ahead of your settings and wins where they conflict. That is what keeps
**Replace draft** working and stops an email you received from steering the
edit. Its text is `CONTRACT` in `src/prompt.js`.

<img src="docs/options.png" width="560" alt="The Options page: connection, editing settings, the fixed part and the shortcut" />

## Model and privacy

- **Model** in Options takes any ID from openrouter.ai/models. The default is
  `anthropic/claude-opus-5.5`.
- The model sees your settings, the draft text, the subject, the recipients and
  the expanded messages of the open thread. It does not see your signature,
  quoted mail or attachments.
- The text goes to OpenRouter and on to the company that runs the model. Which
  of them may keep or train on it is set in your OpenRouter account, under
  Settings → Privacy, not here.
- The API key is stored in Chrome's local extension storage on this computer,
  readable only by the extension, and sent only to openrouter.ai.

## Limits

- Kept: line breaks, links, bold and lists. Other formatting in the draft is
  dropped, and the panel says so before you replace.
- A draft with an image or a table cannot be replaced, only copied.
- Collapsed messages in a thread are not sent. Expand them first if they matter.
- Text typed below the signature or below quoted mail is left alone.
- Every change sends the whole conversation again, so a long back-and-forth
  costs a little more each time.

## Develop

```bash
npm run build   # src/ → extension/dist/
npm test        # builds, tests the OpenRouter client, then runs the extension in Chromium against a mock Gmail
npm run icons   # assets/icon.svg → extension/icons/
```

`SHOTS=<folder> npm test` also saves a screenshot of each state the tests
reach. The two images above come from it.

After a build, press the reload arrow on the extension's card in
`chrome://extensions` and reload Gmail.

Gmail's markup is not a public API. Every selector lives in `src/gmail.js`
(last checked against live Gmail on 2026-11-09). OpenRouter is stubbed in the
tests: its error replies were recorded from the live API, its stream follows
its docs.

The name is short for Rhadamanthus, a judge of the underworld.
