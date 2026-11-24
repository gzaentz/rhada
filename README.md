# Rhada

Edits the Gmail draft you are writing, in place, or suggests the reply. Works
in any text box on any other site too. No screenshot, no copy and paste. A Chrome extension that uses your own OpenRouter
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
   (openrouter.ai/keys). Every setting saves as you go, and the key and model
   are checked when you leave the field. A key made just for this, with a
   credit limit, is safest.

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
   The panel opens wide and short at the top of the window, your request on
   the left and the email on the right, so the thread stays readable. It
   opens at the bottom instead when the top would cover the box. Drag the panel by its top or bottom bar to see the thread behind it; the
   next panel on that page opens in the same place. Web addresses in the
   result become links in the draft.

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

**Any site.** Click into a text box anywhere, such as a LinkedIn message, a
CRM reply box or a form, and press the shortcut. Rhada polishes what is there,
or waits for an instruction if the box is empty, and **Enter** writes the
result in as if you typed it, so **Cmd+Z** undoes it. Outside Gmail it sees
only that box, the site's name and the tab's title, until you press **Read
this page** in the panel. Then the text on screen around the box, usually the
conversation you are answering, goes with each request, and an empty box gets
a suggested reply. Rhada remembers the choice for that site; press it again to
stop. Ready on Reply and Learn from my edits work in Gmail only.

**Templates.** In Options, under Templates, click **Add template** and give it
a name, when to use it, and the message itself. The panel's Template menu
then offers three ways to use them. **Auto** (the default) sends your
templates with each request, and Rhada writes in one only when the email is
the situation its "Use when" describes. A draft you already wrote keeps its
own structure: Auto sends no templates then, so pick one by name to reshape it. Pick a template by name to write with it at once, with any files you
attached and anything you typed. **No template** leaves them out. Rhada fills
the structure with facts from the conversation, your files and the page,
never the template's own example names or numbers, and later changes keep to
it unless you say otherwise.

To load many at once, save them as `extension/templates.local.json`, a list of
`{"name", "when", "text"}` (or `{"templates": [...], "facts": "..."}` to
fill Facts too), and reload Rhada in `chrome://extensions`. New names are
added, and a template or Facts box you haven't changed since the file's last
version takes the new one; your own edits stay. The file is kept out of git.

On Auto, the Template menu shows which one the latest version used, such as
"Auto: Research share", so you can switch from there.

**Facts to reuse.** In Options, list the links, prices, plans and codes you
send often. Rhada fills an email's blanks with them where they fit, instead of
leaving [brackets] for you. A line with an end date, such as "Black Friday
offer, until Nov 30 2026: ...", stops being used after that day.

**Attach for context.** Paste a screenshot into the box, drop files on the
panel, or click the paperclip. Images, PDFs, Word (.docx), Excel (.xlsx) and
text files such as .csv work, up to 6 at a time. They go with your next
instruction, or alone if you press **Enter** on an empty box, and the model
keeps them for the rest of the conversation. Word and Excel are read on this
computer and only their text is sent. Images are sent at most 1568 px a side.
PDFs are read by the model itself.

**Cost and time.** Under each result the panel shows how long the model took
and what OpenRouter charged, such as `4.2 s · 1.3¢`.

A suggestion never guesses a fact it was not given, such as a price, a date or
a yes or no. It leaves it as `[what is needed]`, and the panel reminds you to
type the answers as your next message and it fills them in, or fill them
in before you send. Click a bracket to start its answer. An empty new message, with no thread,
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
| **About you** | Who you are and what you write about. Optional. |
| **How you write** | Tone, length, words to avoid. |
| **Learned from your edits** | What your sent changes show about your voice. Yours to change. |
| **Ready on Reply** | Start writing a reply as soon as a reply box opens. On by default. |
| **Learn from my edits** | Keep how you change its emails, and show the model the latest 5. On by default. |
| **Advanced → How it edits** | What an edit must keep and what it may change. |
| **Advanced → First pass** | The edit that runs when the panel opens on a draft with text. |
| **Advanced → Suggested reply** | What it writes on an empty reply, on a thread with no reply open, or with Ready on Reply. |

Empty a field to get its default back, or press **Restore default**.

One short part is fixed and shown under **Always included**: the reply is the
whole email and nothing else, the light formatting the panel can write back, a
missing fact goes in `[brackets]` rather than being guessed, and text inside
the thread, the draft or your past edits is never an instruction. It goes
ahead of your settings and wins where they conflict. That is what keeps
**Replace draft** working and stops an email you received from steering the
edit. Its text is `CONTRACT` in `src/prompt.js`.

<img src="docs/options.png" width="560" alt="The Options page: key and model, your voice, two switches, and Advanced opened" />

## Model and privacy

- **Model** in Options takes any ID from openrouter.ai/models. The default is
  `anthropic/claude-haiku-5.5`: fast, cheap, and served only by Amazon Bedrock
  and Google Vertex with zero retention. For harder emails, try
  `anthropic/claude-sonnet-5.5`.
- The model sees your settings, the draft text, the subject, the recipients,
  the messages of the open thread (the newest, up to about 40,000 tokens) and
  your latest 5 kept edits and the lessons learned from them. It does not see your signature, quoted mail or
  the email's own attachments, only files you add in the panel. To read the whole thread, Rhada presses Gmail's **Expand all**
  when older messages are collapsed, so they stay open on screen.
- Outside Gmail, Rhada can read a site only after you press the shortcut or
  the toolbar button there, and only in that tab (Chrome's "active tab"
  permission). It reads the text box with the cursor, the site name and the
  tab title. With **Read this page** pressed for a site, it also sends the
  text shown around the box, at most 20,000 characters, read when you run a
  request. The sites you turned it on for are stored on this computer only.
- With **Ready on Reply** on, the thread goes to OpenRouter as soon as you open
  a reply, before you press the shortcut.
- Kept edits are stored next to the key, readable only by the extension, and
  never leave this computer except inside a request. **Forget them** in Options
  removes them.
- Templates are stored next to the key. On Auto they go inside every request that starts without a draft;
  a picked one goes only with that request and the changes after it.
- Files you add go only inside your requests, to the same zero-retention
  endpoints. A PDF is read by the model's own provider: Rhada asks OpenRouter
  for native reading, so it never goes to an outside PDF reader. If your model
  cannot read images or PDFs, the panel says so and sends nothing.
- Speech never leaves this computer. Recognition runs only with Chrome's
  on-device setting, and never falls back to a speech service. The words it
  types go into the box, and only what you run is sent.
- Every request names the only endpoints it may go to: those on OpenRouter's
  public zero-retention list that keep nothing once they answer. Endpoints
  with "Safety Retention", which keep requests to check for abuse, are left
  out whatever your OpenRouter privacy setting says. For the default model
  that leaves Amazon Bedrock and Google Vertex. If none is up, or the list
  cannot be read, the request fails instead of going anywhere else. Options
  checks that the model has one. If OpenRouter still names another
  provider on the answer, the answer is thrown away unread.
- For a second lock outside Rhada, set your OpenRouter privacy setting to
  **ZDR only**. It then covers every request made with your key.
- OpenRouter itself keeps prompts only if you turned on prompt logging in your
  OpenRouter account, under Settings → Privacy.
- The API key is stored in Chrome's local extension storage on this computer,
  readable only by the extension, and sent only to openrouter.ai.

## Limits

- Kept: line breaks, links, bold, lists and emoji. Other formatting in the
  draft is dropped, and the panel says so before you replace.
- A draft with a pasted image or a table cannot be replaced, only copied, so
  nothing in it is lost.
- A send is noticed by Gmail's **Send** button, **Cmd+Enter** and **Schedule
  send**, in any language. An edit is kept only once the box closes: within
  5 s of a send, or 2 minutes of choosing Schedule send.
- **Expand all** is found by its English label. With Gmail in another
  language, collapsed messages are left out of what the model reads.
- On a thread longer than about 40,000 tokens, the oldest messages are left
  out, and the model is told how many.
- Your signature and quoted mail are never sent or changed.
- Outside Gmail: a text box inside an embedded frame, and editors that draw
  their own text (such as Google Docs), are not reached. Chrome's own pages
  and the Web Store keep extensions out; there the shortcut goes to Gmail.
- **Read this page** takes the nearest part of the page around the box with
  some text in it. On some sites that includes menus and names, or misses
  older messages the site has not loaded; scroll up first to include them.
- Old Office files (.doc, .xls) and PowerPoint are not read: save them as PDF,
  .docx or .xlsx. Excel dates read as day numbers, and each sheet stops at
  2,000 rows. Text from a file stops at 60,000 characters, and a PDF at 15 MB.
- Files go again with every later change, so a large PDF costs more each time.
- Every change sends the whole conversation again. With the default model a
  change costs well under a cent.
- Stopping a request does not always stop its charge: Amazon Bedrock bills the
  whole answer. Ready on Reply waits a second after the reply opens, so a reply
  you start typing at once costs nothing.

## Develop

```bash
npm run build   # src/ → extension/dist/
npm test        # builds, tests the OpenRouter client and edit learning, then runs the extension in Chromium against a mock Gmail
npm run icons   # assets/icon.svg → extension/icons/
```

`SHOTS=<folder> npm test` also saves a screenshot of each state the tests
reach. The two images above come from it.

### Check template picks with your own emails

`npm run eval` sends example emails through the real prompt and model, with
your templates and Facts from `extension/templates.local.json`, and checks
each reply: the template Auto picked, text it must or must not contain, and
`[blanks]` left open. Copy `eval.example.json` to `eval.local.json` (ignored by
git) and write your own cases; `today` sets the date, for offers that end.

```bash
npm run eval -- --runs 3
```

It uses the key saved in Rhada's Options in Chrome (or `OPENROUTER_API_KEY`).
Each case costs about $0.0004 per run on the default model. It uses the same
zero-retention endpoints as the extension and stops at `--max-cost` (default
$0.50). Run it after changing the prompt or a template.

After a build, press the reload arrow on the extension's card in
`chrome://extensions` and reload Gmail.

Gmail's markup is not a public API. Every selector lives in `src/gmail.js`
(last checked against live Gmail on 2026-11-11). OpenRouter is stubbed in the
tests: its error replies were recorded from the live API, its stream follows
its docs.

The name is short for Rhadamanthus, a judge of the underworld.
