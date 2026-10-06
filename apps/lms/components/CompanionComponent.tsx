"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { configureAssistant } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { Message } from "@/types/messages";
import { addToSessionHistory } from "@/lib/actions/companion.actions";
import { extractCode, speechOnly } from "@/lib/codeFromText";
import { DEFAULT_LANGUAGE, getLanguage } from "@/constants/languages";
import SessionRail, { type RailMessage } from "@/components/session/SessionRail";
import CodeWorkspace, { type CodeWorkspaceHandle } from "@/components/workspace/CodeWorkspace";
import NotesBoard from "@/components/workspace/NotesBoard";
import SpatialStage from "@/components/workspace/SpatialStage";

/**
 * A session: a voice call on the right, and whatever that subject produces on
 * the left.
 *
 * The one rule that shapes this file is that the companion's output has two
 * destinations and they must not be confused. Speech belongs in the transcript.
 * Code belongs in the editor. When the tutor says "here's how you'd write it"
 * and then emits a fenced block, the sentence goes into the conversation and
 * the program goes into the document, where it can be edited and run. Sending
 * both to the same chat bubble — which is what happened before — gives you a
 * wall of unusable text and an empty editor beside it.
 */

type Role = "user" | "assistant" | "system";

interface CompanionComponentProps {
  companionId: string;
  subject: string;
  topic?: string;
  name: string;
  userName: string;
  userImage?: string;
  style?: string;
  voice?: string;
}

type Status = "idle" | "connecting" | "live" | "ended";

/** Which panel sits beside the conversation. */
function workspaceKind(subject: string) {
  if (subject === "coding") return "code" as const;
  if (subject === "language" || subject === "law") return "scene" as const;
  return "notes" as const;
}

export default function CompanionComponent({
  companionId,
  subject,
  topic = "",
  name,
  userName,
  userImage = "",
  style = "casual",
  voice = "female",
}: CompanionComponentProps) {
  const [messages, setMessages] = useState<RailMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const editor = useRef<CodeWorkspaceHandle>(null);
  const kind = workspaceKind(subject);
  const isCoding = kind === "code";

  // The live call's system prompt is built once at start, so the language the
  // student had selected at that moment is what the tutor is told to write in.
  // Changing it mid-call updates this ref, and the next typed question — which
  // goes through the REST route — picks it up immediately.
  const langRef = useRef(DEFAULT_LANGUAGE);

  const push = useCallback((role: Role, content: string) => {
    if (!content.trim()) return;
    setMessages((prev) => [...prev, { role, content }]);
  }, []);

  /** Route a finished assistant turn: prose to the rail, code to the editor. */
  const receive = useCallback(
    (text: string) => {
      if (!isCoding) {
        push("assistant", text);
        return;
      }
      const found = extractCode(text);
      if (found) {
        editor.current?.applyCode(found.code, found.spec?.id ?? null);
        push("assistant", speechOnly(text));
      } else {
        push("assistant", text);
      }
    },
    [isCoding, push],
  );

  useEffect(() => {
    const onCallStart = () => {
      setStatus("live");
      setNotice(null);
    };

    const onCallEnd = () => {
      setStatus("ended");
      setSpeaking(false);
      addToSessionHistory(companionId);
    };

    const onMessage = (msg: Message) => {
      if (msg.type !== "transcript" || msg.transcriptType !== "final") return;
      const role = msg.role.toLowerCase() as Role;
      if (role === "assistant") receive(msg.transcript);
      else push(role, msg.transcript);
    };

    const onSpeechStart = () => setSpeaking(true);
    const onSpeechEnd = () => setSpeaking(false);

    // Without this the UI sat on "connecting" forever whenever the mic was
    // blocked or the key was wrong, with nothing on screen to say why.
    const onError = (err: unknown) => {
      console.error("[vapi]", err);
      setStatus("idle");
      setSpeaking(false);
      setNotice(
        "The voice connection failed. Check that the microphone is allowed for this site, then try again.",
      );
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);
      // Leaving the page must hang up. A call that outlives its component keeps
      // the microphone open and keeps billing.
      try {
        vapi.stop();
      } catch {
        /* nothing was running */
      }
    };
  }, [companionId, push, receive]);

  const start = () => {
    setStatus("connecting");
    setNotice(null);
    langRef.current = editor.current?.getLanguageId() ?? DEFAULT_LANGUAGE;

    try {
      vapi.start(
        configureAssistant(voice, style, {
          subject,
          language: isCoding ? getLanguage(langRef.current).label : undefined,
        }),
        {
          variableValues: { subject, topic, style },
          clientMessages: ["transcript"],
          serverMessages: [],
        },
      );
    } catch (err) {
      console.error("[vapi start]", err);
      setStatus("idle");
      setNotice("Could not start the session. Reload the page and try again.");
    }
  };

  const end = () => {
    vapi.stop();
    setStatus("ended");
  };

  const toggleMic = () => {
    const next = !muted;
    vapi.setMuted(next);
    setMuted(next);
  };

  /**
   * A typed question.
   *
   * In the coding companion this always produces code, which is the point of
   * the panel: you ask about recursion and a recursive function appears, ready
   * to run, rather than a paragraph describing one. If the call is live the
   * same question is also handed to the voice tutor, so it can talk over what
   * just appeared instead of answering something else.
   */
  const send = async (text: string) => {
    push("user", text);

    if (status === "live") {
      try {
        vapi.send({ type: "add-message", message: { role: "user", content: text } });
      } catch (err) {
        console.error("[vapi send]", err);
      }
    }

    if (!isCoding) return;

    setThinking(true);
    setNotice(null);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          language: editor.current?.getLanguageId() ?? langRef.current,
          topic,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setNotice(data.error ?? "The code assistant did not answer.");
        return;
      }
      if (data.code) {
        editor.current?.applyCode(data.code, data.language);
        // Only when the call is silent does the explanation need to be read.
        // During a live call the tutor is already saying it out loud, and
        // printing it as well makes the student read and listen to the same
        // sentence at once.
        if (status !== "live" && data.explanation) push("assistant", data.explanation);
        else if (status !== "live") push("assistant", "Written into the editor.");
      }
    } catch (err) {
      console.error("[generate-code]", err);
      setNotice("Could not reach the code assistant.");
    } finally {
      setThinking(false);
    }
  };

  return (
    <section className="session-shell">
      <div className="min-h-0 min-w-0 flex-1">
        {kind === "code" && (
          <CodeWorkspace
            ref={editor}
            companionId={companionId}
            topic={topic}
            onLanguageChange={(spec) => {
              langRef.current = spec.id;
            }}
          />
        )}

        {kind === "notes" && (
          <NotesBoard
            subject={subject}
            topic={topic}
            companionName={name}
            messages={messages}
          />
        )}

        {kind === "scene" && subject === "language" && (
          <SpatialStage
            subject={subject}
            title="speaking partner"
            description="A model that speaks with you, so pronunciation and mouth shape are something you can watch rather than guess at."
            envVar="NEXT_PUBLIC_LANGUAGE_SCENE_URL"
            src={process.env.NEXT_PUBLIC_LANGUAGE_SCENE_URL}
            caption={topic}
            companionId={companionId}
          />
        )}

        {kind === "scene" && subject === "law" && (
          <SpatialStage
            subject={subject}
            title="courtroom"
            description="The hearing itself — bench, box and counsel — with this session driving who speaks and when."
            envVar="NEXT_PUBLIC_COURTROOM_URL"
            src={process.env.NEXT_PUBLIC_COURTROOM_URL}
            caption={topic}
            companionId={companionId}
            // Only a hearing has seats to choose between.
            seats
          />
        )}
      </div>

      <div className="session-rail">
        {notice && (
          <p className="tool border-[var(--bad)] px-3 py-2 text-xs leading-relaxed text-[var(--bad)]">
            {notice}
          </p>
        )}
        <SessionRail
          name={name}
          subject={subject}
          topic={topic}
          userName={userName}
          userImage={userImage}
          status={status}
          speaking={speaking}
          muted={muted}
          messages={messages}
          thinking={thinking}
          composerHint={
            isCoding ? "Ask for code — it appears in the editor" : "Ask a question"
          }
          onStart={start}
          onEnd={end}
          onToggleMic={toggleMic}
          onSend={send}
        />
      </div>
    </section>
  );
}
