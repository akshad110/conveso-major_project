import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { subjectsColors, subjectGlow, voices } from "@/constants";
import { CreateAssistantDTO } from "@vapi-ai/web/dist/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The pastel. Used as a fill behind the black subject glyphs. */
export const getSubjectColor = (subject: string) => {
  return subjectsColors[subject as keyof typeof subjectsColors] ?? "#E5D0FF";
};

/**
 * The same hue turned up until it reads as light.
 *
 * Only ever applied to hairlines, labels and focus rings. The pastel is a
 * material; this is the lamp above it.
 */
export const getSubjectGlow = (subject: string) => {
  return subjectGlow[subject as keyof typeof subjectGlow] ?? "#B18CFF";
};

/** "45" -> "45 min". Durations are machine facts, so they are set in mono. */
export const formatDuration = (minutes: number | string) => {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return "—";
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};

export const configureAssistant = (
  voice: string,
  style: string,
  opts?: { subject?: string; language?: string },
) => {
  const voiceId = voices[voice as keyof typeof voices][
    style as keyof (typeof voices)[keyof typeof voices]
  ] || "sarah";

  /**
   * Only the coding companion is told it has an editor.
   *
   * Every companion used to get this paragraph, which is why a history tutor
   * would occasionally answer a question about the Treaty of Versailles with a
   * Python snippet. The workspace beside the transcript is different per
   * subject, so the instruction about it has to be too.
   */
  const workspaceRule =
    opts?.subject === "coding"
      ? `You are sitting beside a live code editor and everything you put in a markdown code fence appears in it instantly, in front of the student.
                    Write the fence as \`\`\`${opts?.language ?? "python"} unless the student asks for a different language.
                    Put complete, runnable programs in the fence — the student can press Run — and never abbreviate with "...".
                    Then talk about the code rather than reading it out. Say what it does and why, and refer to it as "the editor", because they are looking at it.
                    Default to ${opts?.language ?? "Python"}; that is what their editor is set to right now.`
      : `You have no editor in this session. Teach out loud, in speech, and do not write code.`;

  const vapiAssistant: CreateAssistantDTO = {
    name: "Companion",
    firstMessage:
      "Hello, let's start the session. Today we'll be talking about {{topic}}.",
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
    },
    voice: {
      provider: "11labs",
      voiceId: voiceId,
      stability: 0.4,
      similarityBoost: 0.8,
      speed: 1,
      style: 0.5,
      useSpeakerBoost: true,
    },
    model: {
      provider: "openai",
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a highly knowledgeable tutor teaching a real-time voice session with a student. Your goal is to teach the student about the topic and subject.

                    Tutor Guidelines:
                    Stick to the given topic - {{ topic }} and subject - {{ subject }} and teach the student about it.
                    Keep the conversation flowing smoothly while maintaining control.
                    From time to time make sure that the student is following you and understands you.
                    Break down the topic into smaller parts and teach the student one part at a time.
                    Keep your style of conversation {{ style }}.
                    Keep your responses short, like in a real voice conversation. This is speech, so no lists, no headings, no asterisks.

                    ${workspaceRule}
              `,
        },
      ],
    },
    clientMessages: [],
    serverMessages: [],
  };
  return vapiAssistant;
};

export const configureLawAssistant = (
  role: "judge" | "prosecutor" | "defender",
  caseDetails: string
) => {
  const rolePrompts = {
    judge: `You are an experienced, wise, and impartial Judge presiding over a courtroom session. Your role is to:
    - Maintain order and decorum in the court
    - Listen to arguments from both prosecution and defense
    - Ask clarifying questions when needed
    - Evaluate evidence presented
    - Guide the proceedings fairly
    - Make rulings based on facts and law
    
    Case Details: ${caseDetails}
    
    Conduct yourself with dignity and authority. Keep responses measured and professional. 
    When evidence is presented, describe what you observe. Guide the user through proper courtroom procedures.`,

    prosecutor: `You are a skilled Public Prosecutor representing the State. Your role is to:
    - Present the case against the accused
    - Argue based on evidence and facts
    - Question witnesses effectively
    - Establish motive, means, and opportunity
    - Cite relevant IPC sections
    - Build a strong case for conviction
    
    Case Details: ${caseDetails}
    
    Be persuasive but professional. Present arguments logically. Use evidence to support your case.
    Help the user understand prosecution strategies and legal arguments.`,

    defender: `You are a dedicated Defense Counsel protecting the rights of the accused. Your role is to:
    - Present the defense case
    - Challenge prosecution evidence
    - Highlight reasonable doubt
    - Protect client's constitutional rights
    - Cross-examine witnesses
    - Provide alternative explanations
    
    Case Details: ${caseDetails}
    
    Be strategic and thorough. Look for inconsistencies. Present strong defense arguments.
    Guide the user in building an effective defense strategy.`,
  };

  const vapiAssistant: CreateAssistantDTO = {
    name: `Law AI - ${role.charAt(0).toUpperCase() + role.slice(1)}`,
    firstMessage: `Court is now in session. I am the ${role}. Let's proceed with the case.`,
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
    },
    voice: {
      provider: "11labs",
      voiceId: role === "judge" ? "2BJW5coyhAzSr8STdHbE" : "c6SfcYrb2t09NHXiT80T",
      stability: 0.6,
      similarityBoost: 0.8,
      speed: 0.95,
      style: 0.7,
      useSpeakerBoost: true,
    },
    model: {
      provider: "openai",
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: rolePrompts[role] + "\n\nKeep responses concise and courtroom-appropriate. Speak as you would in an actual courtroom.",
        },
      ],
    },
    clientMessages: [],
    serverMessages: [],
  };

  return vapiAssistant;
};

