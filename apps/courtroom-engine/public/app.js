const socket = new WebSocket(`ws://${location.host}`);

const stateEls = {
  phase: document.querySelector("[data-state='phase']"),
  speaker: document.querySelector("[data-state='speaker']"),
  camera: document.querySelector("[data-state='camera']"),
  animation: document.querySelector("[data-state='animation']"),
  evidence: document.querySelector("[data-state='evidence']"),
  memory: document.querySelector("[data-state='memory']")
};

const transcript = document.querySelector("#transcript");
const timeline = document.querySelector("#timeline");
const eventType = document.querySelector("#eventType");
const actor = document.querySelector("#actor");
const question = document.querySelector("#question");
const evidenceTitle = document.querySelector("#evidenceTitle");
const evidenceDescription = document.querySelector("#evidenceDescription");

let currentLine = null;

socket.addEventListener("message", (message) => {
  const payload = JSON.parse(message.data);

  if (payload.type === "STATE" || payload.type === "EVENT") {
    renderState(payload.state);
  }

  if (payload.type === "EVENT") {
    addTimeline(payload.event);
  }

  if (payload.type === "ANIMATION") {
    stateEls.camera.textContent = payload.camera;
    stateEls.animation.textContent = payload.event;
  }

  if (payload.type === "STREAM_START") {
    currentLine = document.createElement("article");
    currentLine.className = `line ${payload.speaker.id}`;
    currentLine.innerHTML = `<strong>${payload.speaker.role}</strong><p></p>`;
    transcript.prepend(currentLine);
  }

  if (payload.type === "STREAM_TOKEN" && currentLine) {
    currentLine.querySelector("p").textContent += payload.token;
  }

  if (payload.type === "ERROR") {
    alert(payload.message);
  }
});

document.querySelector("#startCase").addEventListener("click", () => {
  dispatch({ type: "START_CASE", actor: "judge" });
});

document.querySelector("#reset").addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "RESET" }));
  transcript.innerHTML = "";
  timeline.innerHTML = "";
});

document.querySelector("#quickOpening").addEventListener("click", () => {
  dispatch({ type: "OPENING_STATEMENT", actor: "prosecutor" });
});

document.querySelector("#quickWitness").addEventListener("click", () => {
  dispatch({ type: "ANSWER_WITNESS", actor: "witness" });
});

document.querySelector("#quickObjection").addEventListener("click", () => {
  dispatch({ type: "OBJECTION", actor: "prosecutor", reason: "Leading question" });
});

document.querySelector("#customEvent").addEventListener("submit", (event) => {
  event.preventDefault();

  const type = eventType.value;
  const payload = { type, actor: actor.value };

  if (question.value.trim()) payload.question = question.value.trim();

  if (type === "SUBMIT_EVIDENCE") {
    payload.evidence = {
      title: evidenceTitle.value.trim() || "Transaction Screenshot",
      description: evidenceDescription.value.trim() || "Screenshot submitted for court review.",
      evidenceType: "Document"
    };
  }

  dispatch(payload);
});

function dispatch(event) {
  socket.send(JSON.stringify({ type: "DISPATCH", event }));
}

function renderState(state) {
  if (!state) return;
  stateEls.phase.textContent = state.phase;
  stateEls.speaker.textContent = state.currentSpeaker || "none";
  stateEls.evidence.textContent = `${state.evidence.accepted.length} accepted / ${state.evidence.pending.length} pending / ${state.evidence.rejected.length} rejected`;
  stateEls.memory.textContent = state.shortTermMemory.map((item) => item.summary).slice(-4).join(" | ") || "empty";
}

function addTimeline(event) {
  const item = document.createElement("li");
  item.innerHTML = `<strong>${event.type}</strong><span>${event.actor || "system"}</span>`;
  timeline.prepend(item);
}
