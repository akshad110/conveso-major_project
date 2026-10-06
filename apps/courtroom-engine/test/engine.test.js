import assert from "node:assert/strict";
import test from "node:test";

import { CourtroomEngine } from "../src/engine.js";

test("dispatching case and evidence events updates courtroom state", () => {
  const engine = new CourtroomEngine();

  engine.dispatch({ type: "START_CASE", actor: "judge" });
  assert.equal(engine.snapshot().phase, "case_introduction");
  assert.equal(engine.snapshot().currentSpeaker, "judge");

  engine.dispatch({
    type: "SUBMIT_EVIDENCE",
    actor: "defense",
    evidence: {
      id: "EX-P1",
      title: "UPI transaction screenshot",
      description: "Payment request and destination account details.",
      evidenceType: "Document"
    }
  });

  const state = engine.snapshot();
  assert.equal(state.currentSpeaker, "clerk");
  assert.equal(state.evidence.pending.length, 1);
  assert.equal(state.evidence.pending[0].title, "UPI transaction screenshot");
});

test("accepting pending evidence moves it into long-term memory", () => {
  const engine = new CourtroomEngine();

  engine.dispatch({
    type: "SUBMIT_EVIDENCE",
    actor: "clerk",
    evidence: {
      id: "EX-P2",
      title: "Device access log",
      description: "Login timestamp from disputed device.",
      evidenceType: "Document"
    }
  });

  engine.dispatch({ type: "ACCEPT_EVIDENCE", actor: "judge", evidenceId: "EX-P2" });

  const state = engine.snapshot();
  assert.equal(state.evidence.pending.length, 0);
  assert.equal(state.evidence.accepted.length, 1);
  assert.deepEqual(state.longTermMemory.acceptedEvidence, ["Device access log"]);
});
