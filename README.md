# Rhada

Edits the Gmail draft you are writing, in place, or suggests the reply. No
screenshot, no copy and paste. A Chrome extension that uses your own OpenRouter
key.

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

Gmail tabs that were already open work too: the first press adds the panel.

## Use

1. Click into a draft and press **Control+Shift+E**, or click the toolbar
   button. Options shows the shortcut Chrome has set and a button to change it.
   Pressed outside Gmail, it takes you to your Gmail tab.
2. A draft with text is polished right away. An empty reply gets a suggested
   reply right away, written from the open thread. Type an instruction and press
   **Enter** to change the result: "shorter", "warmer", "say no politely".
   Keep going as long as you like. Each change builds on the last, and the
   model remembers every version, so "undo that" and "go back to the first
   one" work.
3. Press **Enter** on an empty box to replace the draft. **Cmd+Z** in the draft
   undoes it. **Esc** closes the panel and changes nothing.

Reading a thread with no reply open, press the shortcut there to get a
suggestion. Click **Reply** and press it again: the panel moves into the reply
box with the suggestion ready, and **Enter** writes it in.

**Ready on Reply.** Click **Reply** and Rhada starts writing at once. A note at
the bottom of the screen says **Reply ready** when it is done; click it or press
the shortcut and the reply is already there. Start typing your own reply and
it stops. It is on by default and can be turned off in Options. Each reply it
writes costs a suggestion, whether you use it or not.

**One tap.** On a reply, the panel offers **Yes**, **Decline politely**, **Ask a
question** and **Propose times**. Each is an instruction like a typed one.

**Following up.** When you sent the thread's latest message, the reply it
suggests is a short follow-up, and the buttons become **Follow up**, **One-line
nudge** and **Propose times**. Your messages are found by the address you are
signed in with; mail sent from another address of yours is not recognised.

**Speak.** The mic beside the box turns what you say into text, on this
computer: Chrome's on-device recognizer, never a speech service. Check the
words and press **Enter**, or press **Enter** while speaking to run them. The
first press checks that Chrome can recognize speech on this computer and may
download its language model. Where it cannot, the mic says so and hears
nothing.

**Cost and time.** Under each result the panel shows how long the model took
and what OpenRouter charged, such as `4.2 s · 1.3¢`.

A suggestion never guesses a fact it was not given, such as a price, a date or
a yes or no. It leaves it as `[what is needed]`, and the panel reminds you to
fill in the brackets before you send. An empty new message, with no thread,
waits for an instruction: "ask Dana for a call next week".

Open the panel again on a draft it just replaced and it carries on the same
conversation: it waits for your next change instead of polishing its own text.
Edit the draft by hand, or close the compose box, and the next open starts
fresh.

If a change fails, the last version stays on screen and your instruction goes
back in the box, so **Enter** tries again.

**Learn from my edits.** When you change what Rhada wrote and send it, both
versions are kept in this browser. The latest 5 go with every request, so it
writes more the way you edit. Filling in the `[brackets]` alone is not a change.
Options shows how many are kept and can forget them.

Each kept edit is also folded into **Learned from your edits**: up to 12 short
lessons about how you write, such as tone, length and sign-offs, never names or
facts. That takes one small request to your model per sent change, through the
same zero-retention providers. The lessons go with every request, so what Rhada
learns lasts beyond the latest 5 edits. Read, change or clear them in Options.

## Make it yours

Everything the model is told about you and about editing is a setting in
Options. Write these in your own words, as "I" and "my".

| Setting | What it is for |
| --- | --- |
| **Context** | Who you are and what you write about. Optional. |
| **How it edits** | What an edit must keep and what it may change. |
| **Voice** | How you write: tone, length, words to avoid. |
| **First pass** | The edit that runs when the panel opens on a draft with text. |
| **Suggested reply** | What it writes on an empty reply, on a thread with no reply open, or with Ready on Reply. |
| **Ready on Reply** | Start writing a reply as soon as a reply box opens. On by default. |
| **Learn from my edits** | Keep how you change its emails, and show the model the latest 5. On by default. |

Empty a field and save to get its default back, or press **Restore default**.

One short part is fixed and shown under **Always included**: the reply is the
whole email and nothing else, the light formatting the panel can write back, a
missing fact goes in `[brackets]` rather than being guessed, and text inside
the thread, the draft or your past edits is never an instruction. It goes
ahead of your settings and wins where they conflict. That is what keeps
**Replace draft** working and stops an email you received from steering the
edit. Its text is `CONTRACT` in `src/prompt.js`.

<img src="docs/options.png" width="560" alt="The Options page: connection, automatic settings, editing settings, the fixed part and the shortcut" />

## Model and privacy

- **Model** in Options takes any ID from openrouter.ai/models. The default is
  `anthropic/claude-opus-5.5`.
- The model sees your settings, the draft text, the subject, the recipients,
  the messages of the open thread (the newest, up to about 12,000 tokens) and
  your latest 5 kept edits. It does not see your signature, quoted mail or
  attachments. To read the whole thread, Rhada presses Gmail's **Expand all**
  when older messages are collapsed, so they stay open on screen.
- With **Ready on Reply** on, the thread goes to OpenRouter as soon as you open
  a reply, before you press the shortcut.
- Kept edits are stored next to the key, readable only by the extension, and
  never leave this computer except inside a request. **Forget them** in Options
  removes them.
- Speech never leaves this computer. Recognition runs only with Chrome's
  on-device setting, and never falls back to a speech service. The words it
  types go into the box, and only what you run is sent.
- Every request names the only endpoints it may go to: those on OpenRouter's
  public zero-retention list that keep nothing once they answer. Endpoints
  with "Safety Retention", which keep requests to check for abuse, are left
  out whatever your OpenRouter privacy setting says. For the default model
  that leaves Amazon Bedrock and Google Vertex. If none is up, or the list
  cannot be read, the request fails instead of going anywhere else. **Save**
  in Options checks that the model has one. If OpenRouter still names another
  provider on the answer, the answer is thrown away unread.
- For a second lock outside Rhada, set your OpenRouter privacy setting to
  **ZDR only**. It then covers every request made with your key.
- OpenRouter itself keeps prompts only if you turned on prompt logging in your
  OpenRouter account, under Settings → Privacy.
- The API key is stored in Chrome's local extension storage on this computer,
  readable only by the extension, and sent only to openrouter.ai.

## Limits

- Kept: line breaks, links, bold and lists. Other formatting in the draft is
  dropped, and the panel says so before you replace.
- A draft with an image or a table cannot be replaced, only copied.
- A send is noticed by Gmail's **Send** button and **Cmd+Enter**, found by the
  button's English tooltip and Gmail's class name. Scheduled send and other
  languages may not count, so those edits are not learned. An edit is kept
  only once the box closes, within 5 s of the send.
- **Expand all** is found by its English label. With Gmail in another
  language, collapsed messages are left out of what the model reads.
- Ready on Reply starts only for a reply box that opens empty on a thread you
  are reading, not for a forward or a new message.
- On a very long thread, the oldest messages are left out, and the model is
  told how many.
- Text typed below the signature or below quoted mail is left alone.
- Every change sends the whole conversation again, so a long back-and-forth
  costs a little more each time.
- Stopping a request does not always stop its charge. Amazon Bedrock, which
  serves the default model, bills the whole answer. Ready on Reply waits a
  second after the reply opens, so a reply you start typing at once costs
  nothing.

## Develop

```bash
npm run build   # src/ → extension/dist/
npm test        # builds, tests the OpenRouter client and edit learning, then runs the extension in Chromium against a mock Gmail
npm run icons   # assets/icon.svg → extension/icons/
```

`SHOTS=<folder> npm test` also saves a screenshot of each state the tests
reach. The two images above come from it.

After a build, press the reload arrow on the extension's card in
`chrome://extensions` and reload Gmail.

Gmail's markup is not a public API. Every selector lives in `src/gmail.js`
(last checked against live Gmail on 2026-11-11). OpenRouter is stubbed in the
tests: its error replies were recorded from the live API, its stream follows
its docs.

The name is short for Rhadamanthus, a judge of the underworld.
