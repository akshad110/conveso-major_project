# AI Courtroom Simulation Engine

This is a separate runnable engine for your courtroom project. It is not a website clone.

It implements the architecture from the spec as an MVP:

- Event-driven Courtroom State Engine
- Multi-agent courtroom roles
- WebSocket streaming responses
- Objection and interruption flow
- Evidence submission state
- Camera and animation events for a future 3D scene
- Browser control panel for testing

## Requirements

Use Node.js 18 or newer.

No package install is required for the current MVP.

## Run It

> To run this together with the 3D courtroom, use the top-level `README.md` and
> `start.sh` one directory up. This section is the engine on its own.

From this folder:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4177
```

## Test It In The Browser

Try this flow:

1. Click `Start Case`.
2. Click `Prosecutor Opening`.
3. Select `SUBMIT_EVIDENCE`, enter an evidence title, then click `Dispatch Event`.
4. Select `QUESTION_WITNESS`, keep actor as `Defense Lawyer`, enter a question, then click `Dispatch Event`.
5. Click `Raise Objection` to see the objection and judge ruling path.

The live transcript streams word by word. The top status bar shows phase, current speaker, camera event, and animation event.

## Project Structure

```text
courtroom-simulation-engine/
  server/
    index.js          HTTP and WebSocket server
  src/
    engine.js         Courtroom state engine and event state machine
    agents.js         Agent roles, behavior, speech generation, interruption checks
  public/
    index.html        Test UI
    app.js            Browser WebSocket client
    styles.css        Test UI styles
  examples/
    sample-events.json
```

## How To Connect This To Your 3D Courtroom

Your React Three Fiber frontend should connect to the WebSocket server:

```js
const socket = new WebSocket("ws://127.0.0.1:4177");
```

Listen for these message types:

- `STATE`: full courtroom state snapshot
- `EVENT`: a structured courtroom event
- `STREAM_START`: an agent starts speaking
- `STREAM_TOKEN`: one streamed text token
- `STREAM_END`: speaking finished
- `ANIMATION`: animation and camera instruction
- `ERROR`: server error

Dispatch events like this:

```js
socket.send(JSON.stringify({
  type: "DISPATCH",
  event: {
    type: "QUESTION_WITNESS",
    actor: "defense",
    question: "You did not personally see who created the payment link, correct?"
  }
}));
```

## Important Design Rule

Agents do not talk directly to each other. Every action goes through the Courtroom State Engine. This keeps the simulation consistent and makes it easier to connect animation, camera, evidence monitors, and future LLM calls.

## Next Upgrades

Good next steps for your full project:

- Replace rule-based speech in `src/agents.js` with real LLM calls.
- Add case files and witness profiles as JSON.
- Add authentication and session storage.
- Add React Three Fiber client that maps `ANIMATION` messages to character animations.
- Add evidence media upload and courtroom monitor rendering.
