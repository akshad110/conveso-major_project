import { EventEmitter } from "node:events";
import { agentForEvent, agents, generateAgentSpeech, shouldInterrupt } from "./agents.js";

const initialCase = {
  title: "State versus Dev Malhotra",
  jurisdiction: "Training simulation inspired by Indian courtroom procedure",
  summary: "A digital payment fraud matter where the complainant alleges funds were diverted through a cloned payment link.",
  charges: ["Cheating", "Identity misuse", "Digital payment fraud"],
  hiddenFacts: ["Only the simulation engine can see hidden consistency notes."]
};

export class CourtroomEngine {
  constructor() {
    this.emitter = new EventEmitter();
    this.streamQueue = Promise.resolve();
    this.reset(false);
  }

  reset(emit = true) {
    this.streamQueue = Promise.resolve();
    this.state = {
      phase: "idle",
      currentSpeaker: null,
      speakingQueue: [],
      case: initialCase,
      evidence: {
        pending: [],
        accepted: [],
        rejected: []
      },
      pendingObjection: null,
      verdictStatus: "not_started",
      emotionalState: {
        judge: "calm",
        prosecutor: "focused",
        defense: "confident",
        witness: "nervous",
        defendant: "anxious"
      },
      shortTermMemory: [],
      longTermMemory: {
        knownFacts: [
          "The complainant paid through a link received on a mobile phone.",
          "The destination account is disputed.",
          "Identity of the link creator is not yet proven."
        ],
        previousTestimony: [],
        acceptedEvidence: []
      },
      timeline: []
    };

    if (emit) {
      this.broadcast({ type: "STATE", state: this.snapshot() });
    }
  }

  onBroadcast(listener) {
    this.emitter.on("broadcast", listener);
  }

  snapshot() {
    return {
      ...this.state,
      agents: Object.values(agents).map(({ restrictions, goals, ...agent }) => ({
        ...agent,
        goals,
        restrictions
      }))
    };
  }

  dispatch(rawEvent = {}) {
    const event = this.normalizeEvent(rawEvent);
    this.applyEvent(event);
    this.broadcast({ type: "EVENT", event, state: this.snapshot() });

    const agent = agentForEvent(event);
    const speech = generateAgentSpeech(agent, this.state, event);
    this.streamQueue = this.streamQueue
      .then(() => this.streamSpeech(agent, speech, event))
      .catch((error) => {
        this.broadcast({ type: "ERROR", message: error.message });
      });
  }

  normalizeEvent(rawEvent) {
    const event = {
      id: rawEvent.id || cryptoRandomId(),
      type: rawEvent.type || "CONTINUE",
      actor: rawEvent.actor,
      timestamp: new Date().toISOString(),
      ...rawEvent
    };

    if (event.type === "SUBMIT_EVIDENCE") {
      event.evidence = {
        id: event.evidence?.id || `EX-${this.state.timeline.length + 1}`,
        title: event.evidence?.title || "Untitled Evidence",
        description: event.evidence?.description || "No description supplied.",
        evidenceType: event.evidence?.evidenceType || "Document",
        status: "pending",
        submittedBy: event.actor || "user",
        timestamp: event.timestamp
      };
    }

    return event;
  }

  applyEvent(event) {
    if (event.type === "START_CASE") this.state.phase = "case_introduction";
    if (event.type === "OPENING_STATEMENT") this.state.phase = "opening";
    if (event.type === "QUESTION_WITNESS" || event.type === "ANSWER_WITNESS") this.state.phase = "witness_examination";
    if (event.type === "FINAL_ARGUMENT") this.state.phase = "final_arguments";
    if (event.type === "VERDICT") {
      this.state.phase = "verdict";
      this.state.verdictStatus = "delivered";
    }

    if (event.type === "SUBMIT_EVIDENCE") {
      this.state.evidence.pending.push(event.evidence);
    }

    if (event.type === "ACCEPT_EVIDENCE") {
      this.moveEvidence(event.evidenceId, "accepted");
    }

    if (event.type === "REJECT_EVIDENCE") {
      this.moveEvidence(event.evidenceId, "rejected");
    }

    if (event.type === "OBJECTION") {
      this.state.pendingObjection = {
        id: event.id,
        raisedBy: event.actor || "prosecutor",
        reason: event.reason || "Procedure concern",
        recommendedRuling: event.recommendedRuling || "sustained"
      };
    }

    if (event.type === "RULING") {
      this.state.pendingObjection = null;
    }

    const agent = agentForEvent(event);
    this.state.currentSpeaker = agent.id;
    this.state.timeline.push(event);
    this.state.shortTermMemory.push({
      type: event.type,
      actor: agent.id,
      summary: summarizeEvent(event),
      timestamp: event.timestamp
    });
    this.state.shortTermMemory = this.state.shortTermMemory.slice(-20);
  }

  moveEvidence(evidenceId, target) {
    const index = this.state.evidence.pending.findIndex((item) => item.id === evidenceId);
    if (index === -1) return;

    const [item] = this.state.evidence.pending.splice(index, 1);
    item.status = target;
    this.state.evidence[target].push(item);

    if (target === "accepted") {
      this.state.longTermMemory.acceptedEvidence.push(item.title);
    }
  }

  async streamSpeech(agent, text, sourceEvent) {
    const words = text.split(" ");
    let streamed = "";

    this.broadcast({
      type: "ANIMATION",
      event: animationFor(agent.id, sourceEvent.type),
      camera: cameraFor(agent.id, sourceEvent.type),
      agent: agent.id
    });

    this.broadcast({ type: "STREAM_START", speaker: agent, sourceEvent });

    for (const word of words) {
      streamed = streamed ? `${streamed} ${word}` : word;
      this.broadcast({ type: "STREAM_TOKEN", speaker: agent, token: `${word} ` });

      if (shouldInterrupt(streamed, this.state)) {
        this.dispatch({
          type: "OBJECTION",
          actor: "prosecutor",
          reason: "Assumes facts not in accepted evidence",
          interruptedEventId: sourceEvent.id
        });
        this.dispatch({
          type: "RULING",
          actor: "judge",
          ruling: "sustained"
        });
        break;
      }

      await wait(45);
    }

    this.broadcast({ type: "STREAM_END", speaker: agent, text: streamed });
    this.broadcast({ type: "STATE", state: this.snapshot() });
  }

  broadcast(message) {
    this.emitter.emit("broadcast", message);
  }
}

function summarizeEvent(event) {
  if (event.type === "SUBMIT_EVIDENCE") return `Evidence submitted: ${event.evidence.title}`;
  if (event.question) return event.question;
  if (event.reason) return event.reason;
  return event.type;
}

function animationFor(agentId, eventType) {
  if (eventType === "OBJECTION") return "OBJECTING";
  if (eventType === "SUBMIT_EVIDENCE") return "PRESENTING_EVIDENCE";
  if (eventType === "ANSWER_WITNESS") return "WITNESS_TESTIFYING";
  if (agentId === "judge") return "JUDGE_SPEAKING";
  return "SPEAKING";
}

function cameraFor(agentId, eventType) {
  if (eventType === "SUBMIT_EVIDENCE") return "CAMERA_MONITOR";
  if (eventType === "OBJECTION") return "CAMERA_PROSECUTOR";
  if (eventType === "VERDICT") return "CAMERA_WIDE";
  if (agentId === "judge") return "CAMERA_JUDGE";
  if (agentId === "witness") return "CAMERA_WITNESS";
  return `CAMERA_${agentId.toUpperCase()}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}
