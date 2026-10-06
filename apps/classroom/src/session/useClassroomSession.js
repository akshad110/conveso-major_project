"use client";

/**
 * Joining a lesson in this room to the lesson that launched it.
 *
 * This is the only file in the classroom that knows Converso exists. Everything
 * it does happens in a fixed order:
 *
 *   1. exchange the token for the session            (launch.js)
 *   2. tell Converso which room this is              (/api/classroom/session)
 *   3. re-tell it whenever the student changes either
 *   4. count an exchange each time the teacher answers
 *   5. bookmark how far they have got, periodically  (/progress)
 *   6. report counts when the student ends the lesson (/complete)
 *   7. beacon an abandonment if they leave first      (/abandon)
 *
 * Nothing here decides anything about the lesson. The language, the register,
 * the teacher and the questions are all the student's; this file's entire
 * contribution is *telling Converso what happened*, in counts.
 *
 * The one thing it adds to the room is step 6, because a language lesson has no
 * natural end. A hearing closes itself — the engine reaches CASE_CLOSED and the
 * courtroom reports a result. Nothing in a conversation with a teacher ever says
 * "that was the lesson", so a launched classroom gets an explicit way to say it.
 * Without one, every lesson would end as an abandonment and no student would
 * ever score the 15 points `scoreClassroom` gives for finishing.
 *
 * Standalone is untouched. With no `?session=&token=` in the URL, `isLaunched()`
 * is false, every branch below returns early, and the room behaves exactly as it
 * did before any of this existed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FRAME_MESSAGES,
  FRAME_SOURCE,
  LAUNCH_ERRORS,
  SIMULATION_KIND,
} from "@converso/contracts";
import { useAITeacher } from "@/hooks/useAITeacher";
import {
  announceRoom,
  isLaunched,
  launchTarget,
  noteExchange,
  openLaunchSession,
  reportAbandoned,
  reportComplete,
  reportProgress,
} from "./launch";

/**
 * Which refusals are worth a Retry button.
 *
 * A launch token is single-use and spent on the first exchange, so retrying an
 * expired or already-spent one cannot work — offering the button would be
 * telling the student something untrue about their own session. Only a Converso
 * that did not answer is worth asking twice.
 */
const RETRYABLE = new Set([LAUNCH_ERRORS.UNAVAILABLE]);

export function useClassroomSession() {
  /**
   * Read once per mount rather than per render.
   *
   * `isLaunched()` touches `window`, which is absent on the server. Holding the
   * answer in state means the first client render agrees with the server's (both
   * false) and the truth arrives in an effect, which is what keeps React from
   * complaining about a hydration mismatch.
   */
  const [launched, setLaunched] = useState(false);

  const [mode, setMode] = useState("standalone");
  const [refusal, setRefusal] = useState(null);

  /** Guards for the things that must happen exactly once. */
  const handshake = useRef(false);
  const reported = useRef(false);
  /** When the session opened, so the result can say how long the lesson ran. */
  const openedAt = useRef(0);
  /** What was last announced, so an unchanged picker does not re-post. */
  const announced = useRef("");

  /* --- 1: the handshake --------------------------------------------------- */

  const attempt = useCallback(async () => {
    setMode("opening");
    setRefusal(null);

    const result = await openLaunchSession();
    if (!result.ok) {
      setRefusal({ code: result.code, message: result.message });
      setMode("refused");
      return;
    }

    openedAt.current = Date.now();
    setMode("open");
  }, []);

  useEffect(() => {
    if (!isLaunched()) return;
    setLaunched(true);
    if (handshake.current) return;
    handshake.current = true;
    void attempt();
  }, [attempt]);

  /** Ask again. Only offered for a Converso that did not answer. */
  const retry = useCallback(() => {
    if (!RETRYABLE.has(refusal?.code)) return;
    void attempt();
  }, [attempt, refusal]);

  /**
   * Hand the student back to the lesson.
   *
   * This app is in an iframe on a Converso page and has no idea which lesson
   * opened it, so it cannot navigate anywhere useful on its own — it asks the
   * page that framed it to take the panel back. Targeted at the configured
   * Converso origin rather than '*', because a message sent to '*' is a message
   * readable by whoever framed this instead.
   */
  const returnToLesson = useCallback(() => {
    try {
      window.parent?.postMessage(
        {
          source: FRAME_SOURCE[SIMULATION_KIND.CLASSROOM],
          type: FRAME_MESSAGES.RETURN_TO_LESSON,
        },
        launchTarget(),
      );
    } catch {
      /* not framed, or a hostile parent. Nothing useful to do either way. */
    }
  }, []);

  /* --- 2 and 3: which room this is ---------------------------------------- */

  useEffect(() => {
    if (mode !== "open") return undefined;

    const send = ({ language, register }) => {
      const signature = `${language}/${register}`;
      if (announced.current === signature) return;
      announced.current = signature;
      announceRoom({ language, register });
    };

    // The state at the moment the session opened, which is usually the default
    // room but is whatever the student had already chosen if they changed it
    // while the handshake was in flight.
    const first = useAITeacher.getState();
    send({ language: first.language, register: first.speech });

    // `speech` is this app's name for the register: every language offers
    // exactly the two the contract lists, formal and casual, so the value goes
    // across as-is and the route validates it against CLASSROOM_REGISTERS.
    return useAITeacher.subscribe((state) => {
      send({ language: state.language, register: state.speech });
    });
  }, [mode]);

  /* --- 4 and 5: exchanges, and the bookmark ------------------------------- */

  useEffect(() => {
    if (mode !== "open") return undefined;

    let seenQuestions = useAITeacher.getState().questionsAsked;

    // Subscribed rather than read through a selector because none of this is
    // rendered: re-rendering the room to send a counter would be a re-render for
    // something nobody can see.
    return useAITeacher.subscribe((state) => {
      if (state.questionsAsked > seenQuestions) {
        seenQuestions = state.questionsAsked;
        noteExchange(state.ollama?.model);
      }

      /*
       * The progress route whitelists three fields and writes nothing else:
       * turn, phase and camera. A language lesson has no camera and no phases,
       * so it bookmarks the two things a returning student would want to see —
       * how many questions they got through, and which language they were in.
       * The full counts are not here; they ride on /complete, which is what is
       * actually scored.
       */
      reportProgress({ turn: state.questionsAsked, phase: state.language });
    });
  }, [mode]);

  /* --- 6: the result ------------------------------------------------------ */

  const [ending, setEnding] = useState(false);

  const endLesson = useCallback(async () => {
    if (mode !== "open" || reported.current) return;
    reported.current = true;
    setEnding(true);

    const state = useAITeacher.getState();
    const duration = openedAt.current
      ? Math.round((Date.now() - openedAt.current) / 1000)
      : 0;

    // A final bookmark first, so a `/complete` that fails still leaves Converso
    // knowing how far the lesson got.
    reportProgress({ turn: state.questionsAsked, phase: state.language }, { force: true });

    // Counts only. Converso throws away any score sent with them and works out
    // its own from these three numbers — which is the right way round, because
    // this is a browser and a browser can be told to say anything.
    await reportComplete({
      language: state.language,
      register: state.speech,
      questionsAsked: state.questionsAsked,
      phrasesPractised: state.phrasesPractised,
      duration,
      completed: true,
    });

    setMode("finished");
    setEnding(false);
    returnToLesson();
  }, [mode, returnToLesson]);

  /* --- 7: leaving early --------------------------------------------------- */

  useEffect(() => {
    if (!isLaunched()) return undefined;

    // `pagehide` rather than `beforeunload`: it fires for a tab being discarded
    // and for a page going into the back-forward cache, which `beforeunload`
    // does not, and it does not block the unload.
    const leave = () => reportAbandoned();
    window.addEventListener("pagehide", leave);

    return () => {
      window.removeEventListener("pagehide", leave);
      // An unmount that is not a page unload — Converso swapping the panel out
      // — still ends the lesson. `reportAbandoned` declines to fire once a
      // result has been reported, so ending properly and then unmounting does
      // not overwrite the result with an abandonment.
      reportAbandoned();
    };
  }, []);

  return {
    /** False for a standalone classroom: the room should just render. */
    launched,
    mode,
    refusal,
    canRetry: RETRYABLE.has(refusal?.code),
    retry,
    returnToLesson,
    endLesson,
    ending,
    /**
     * True once it is safe to render the room.
     *
     * A standalone classroom is always ready. A launched one waits for the
     * handshake — not because the scene depends on it, but because a student
     * whose session was refused should be told so instead of being dropped into
     * a lesson that records nothing.
     */
    ready: !launched || mode === "open" || mode === "finished",
  };
}
