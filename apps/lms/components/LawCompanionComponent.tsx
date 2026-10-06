"use client";

import { useEffect, useState } from "react";
import { configureLawAssistant } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import Image from "next/image";
import { Message } from "@/types/messages";
import { addToSessionHistory } from "@/lib/actions/companion.actions";
import { lawCases, LawCase } from "@/constants/lawCases";
import { RoleMessage, generateAIRoleResponses } from "@/lib/gemini-roles";
import { Scale, Send, Download } from "lucide-react";

type LawRole = "judge" | "prosecutor" | "defender";
type Role = "user" | "assistant" | "system";

interface SavedMessage {
    role: Role;
    content: string;
}

interface Props {
    companionId: string;
    userName: string;
}

enum CallStatus {
    INACTIVE = "INACTIVE",
    CONNECTING = "CONNECTING",
    ACTIVE = "ACTIVE",
    FINISHED = "FINISHED",
}

export default function LawCompanionComponent({ companionId, userName }: Props) {
    const [lawRole, setLawRole] = useState<LawRole>("judge");
    const [selectedCase, setSelectedCase] = useState<LawCase | null>(null);
    const [sessionStarted, setSessionStarted] = useState(false);
    const [messages, setMessages] = useState<SavedMessage[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [ipcInput, setIpcInput] = useState("");
    const [roleMessages, setRoleMessages] = useState<RoleMessage[]>([]);
    const [callStatus, setCallStatus] = useState(CallStatus.INACTIVE);
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [currentEvidenceIndex, setCurrentEvidenceIndex] = useState(0);

    useEffect(() => {
        const onStart = () => setCallStatus(CallStatus.ACTIVE);
        const onEnd = () => {
            setCallStatus(CallStatus.FINISHED);
            addToSessionHistory(companionId);
        };
        const onMessage = (msg: Message) => {
            if (msg.type !== "transcript" || msg.transcriptType !== "final") return;
            setMessages((prev) => [{ role: msg.role as Role, content: msg.transcript }, ...prev]);
        };
        vapi.on("call-start", onStart);
        vapi.on("call-end", onEnd);
        vapi.on("message", onMessage);

        return () => {
            vapi.off("call-start", onStart);
            vapi.off("call-end", onEnd);
            vapi.off("message", onMessage);
        };
    }, [companionId]);

    const handleStartSession = () => {
        if (!selectedCase) return alert("Select a case first!");
        setSessionStarted(true);
        setCallStatus(CallStatus.CONNECTING);

        const caseDetails = `${selectedCase.title}. ${selectedCase.background}`;

        vapi.start(configureLawAssistant(lawRole, caseDetails), {
            variableValues: { role: lawRole, userName, caseDetails },
            clientMessages: ["transcript"],
            serverMessages: [],
        });
    };

    const sendMessage = async () => {
        if (!inputValue.trim()) return;

        const newMsg = { role: lawRole, content: inputValue, timestamp: Date.now() };
        setRoleMessages((prev) => [...prev, newMsg]);
        setMessages((prev) => [{ role: "user", content: inputValue }, ...prev]);

        if (callStatus === CallStatus.ACTIVE) {
            vapi.send({ type: "add-message", message: { role: "user", content: inputValue } });
        }

        const userInput = inputValue;
        setInputValue("");

        if (!selectedCase) return;
        setIsGeneratingAI(true);

        try {
            const caseDetails = `${selectedCase.title} — ${selectedCase.description}`;
            const ai = await generateAIRoleResponses(lawRole, caseDetails, userInput, roleMessages);

            const t = Date.now();

            if (ai.judge && lawRole !== "judge") {
                setRoleMessages((p) => [...p, { role: "judge", content: ai.judge, timestamp: t + 10 }]);
            }
            if (ai.prosecutor && lawRole !== "prosecutor") {
                setRoleMessages((p) => [...p, { role: "prosecutor", content: ai.prosecutor, timestamp: t + 20 }]);
            }
            if (ai.defender && lawRole !== "defender") {
                setRoleMessages((p) => [...p, { role: "defender", content: ai.defender, timestamp: t + 30 }]);
            }
        } catch (e) {
            console.error("AI Error:", e);
        }

        setIsGeneratingAI(false);
    };

    const downloadSessionPDF = () => {
        window.print();
    };

    const latestAssistantMessage = messages.find((m) => m.role === "assistant")?.content;

    // Get character image based on last speaker
    const getCharacterImage = () => {
        if (roleMessages.length === 0) return "/courtroom/judge-character.jpg";
        const lastSpeaker = roleMessages[roleMessages.length - 1].role;
        const characterImages = {
            judge: "/courtroom/judge-character.jpg",
            defender: "/courtroom/defender.jpg",
            prosecutor: "/courtroom/prosecutor.jpg",
            user: lawRole === "defender" ? "/courtroom/defender.jpg" :
                lawRole === "prosecutor" ? "/courtroom/prosecutor.jpg" : "/courtroom/judge-character.jpg"
        };
        return characterImages[lastSpeaker];
    };

    const getCharacterLabel = () => {
        if (roleMessages.length === 0) return "Judge";
        const lastSpeaker = roleMessages[roleMessages.length - 1].role;
        return lastSpeaker === "user" ? lawRole : lastSpeaker;
    };

    if (!sessionStarted) {
        return (
            <div className="min-h-screen w-full bg-gradient-to-b from-[#1A0F0A] to-[#2B1810] flex flex-col items-center justify-center p-6 overflow-y-auto">
                <div className="max-w-3xl w-full">
                    <h1 className="text-5xl text-[#FF8C42] font-bold text-center mb-6">⚖️ COURTROOM</h1>

                    <div className="bg-[#F4D9A6] border-4 border-[#B86F26] rounded-2xl p-6 mb-6">
                        <h2 className="text-2xl font-bold text-[#2B1810] mb-4">Select Role</h2>
                        <div className="grid grid-cols-3 gap-3">
                            {(["judge", "prosecutor", "defender"] as LawRole[]).map((r) => (
                                <button
                                    key={r}
                                    onClick={() => setLawRole(r)}
                                    className={`p-4 rounded-xl font-bold transition-all ${lawRole === r ? "bg-[#FF8C42] text-white ring-4 ring-[#D4761F]" : "bg-[#E8C896] hover:bg-[#D4761F] hover:text-white"
                                        }`}
                                >
                                    {r.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-[#F4D9A6] border-4 border-[#B86F26] rounded-2xl p-6 mb-6">
                        <h2 className="text-2xl font-bold text-[#2B1810] mb-4">Select Case</h2>
                        <div className="space-y-3">
                            {lawCases.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => setSelectedCase(c)}
                                    className={`w-full p-4 text-left rounded-xl transition-all ${selectedCase?.id === c.id ? "bg-[#FF8C42] text-white ring-4 ring-[#D4761F]" : "bg-[#E8C896] hover:bg-[#D4761F] hover:text-white"
                                        }`}
                                >
                                    <p className="font-bold text-lg">{c.title}</p>
                                    <p className="text-sm opacity-90 mt-1">{c.description}</p>
                                    <div className="flex gap-2 mt-2">
                                        {c.applicableSections.slice(0, 3).map((sec, i) => (
                                            <span key={i} className="px-2 py-1 bg-black/20 rounded-full text-xs font-semibold">
                                                IPC {sec}
                                            </span>
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={() => setSessionStarted(true)}
                        disabled={!selectedCase}
                        className="w-full py-5 bg-[#FF8C42] hover:bg-[#D4761F] text-white font-bold rounded-xl text-2xl disabled:opacity-50 disabled:cursor-not-allowed shadow-xl transition-all"
                    >
                        START SESSION
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 w-screen h-screen flex flex-col bg-gradient-to-b from-[#1A0F0A] via-[#2B1810] to-[#1A0F0A]">
            <div className="bg-gradient-to-r from-[#B86F26] to-[#D4761F] border-b-4 border-[#FF8C42] px-4 py-3 flex-shrink-0">
                <h1 className="text-center text-[#F4D9A6] font-bold text-xl md:text-2xl tracking-wide">
                    {selectedCase?.title}
                </h1>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 min-h-0">
                {/* Left: Evidence */}
                <div className="bg-[#F4D9A6] border-4 border-[#B86F26] rounded-2xl p-4 overflow-y-auto shadow-2xl">
                    {selectedCase && selectedCase.evidence[currentEvidenceIndex] && (
                        <>
                            <div className="mb-2">
                                <p className="text-xs font-bold text-[#2B1810]/60">
                                    EVIDENCE EV-{String(currentEvidenceIndex + 1).padStart(3, "0")}
                                </p>
                                <h3 className="text-lg md:text-xl font-bold text-[#2B1810] mt-1">
                                    {selectedCase.evidence[currentEvidenceIndex].title}
                                </h3>
                                <p className="text-xs md:text-sm text-[#2B1810]/70 capitalize">
                                    {selectedCase.evidence[currentEvidenceIndex].type}
                                </p>
                            </div>

                            <div className="bg-[#E8C896] rounded-xl p-2 mb-3 border-2 border-[#B86F26] shadow-lg">
                                <Image
                                    src={selectedCase.evidence[currentEvidenceIndex].imagePath}
                                    width={400}
                                    height={300}
                                    alt={selectedCase.evidence[currentEvidenceIndex].title}
                                    className="rounded-lg w-full object-cover"
                                />
                            </div>

                            <div className="mb-3">
                                <h4 className="font-bold text-[#2B1810] text-xs md:text-sm mb-1">Evidence Description</h4>
                                <p className="text-xs text-[#2B1810]/80 leading-relaxed">
                                    {selectedCase.evidence[currentEvidenceIndex].description}
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    className="flex-1 py-2 bg-[#B86F26] hover:bg-[#D4761F] text-white rounded-lg font-semibold disabled:opacity-50 transition-all text-xs md:text-sm"
                                    disabled={currentEvidenceIndex === 0}
                                    onClick={() => setCurrentEvidenceIndex((i) => i - 1)}
                                >
                                    ← Prev
                                </button>
                                <button
                                    className="flex-1 py-2 bg-[#B86F26] hover:bg-[#D4761F] text-white rounded-lg font-semibold disabled:opacity-50 transition-all text-xs md:text-sm"
                                    disabled={currentEvidenceIndex === selectedCase.evidence.length - 1}
                                    onClick={() => setCurrentEvidenceIndex((i) => i + 1)}
                                >
                                    Next →
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* Center: Dynamic Character */}
                <div className="hidden md:flex flex-col items-center justify-center min-h-0">
                    <div className="relative">
                        <Image
                            src={getCharacterImage()}
                            alt={getCharacterLabel()}
                            width={400}
                            height={500}
                            className="max-h-[60vh] w-auto object-contain rounded-2xl shadow-2xl transition-all duration-500"
                            key={getCharacterImage()}
                        />
                        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-[#FF8C42] px-4 py-1 rounded-full border-2 border-[#D4761F]">
                            <p className="text-white font-bold text-sm uppercase">{getCharacterLabel()}</p>
                        </div>
                    </div>
                    <div className="mt-6 bg-[#B86F26] p-3 rounded-full border-4 border-[#FF8C42] shadow-xl">
                        <Scale className="w-10 h-10 text-[#F4D9A6]" />
                    </div>
                </div>

                {/* Right: Chat + Session Control */}
                <div className="flex flex-col gap-2 min-h-0">
                    {/* Session Control */}
                    <div className="bg-[#F4D9A6] border-4 border-[#B86F26] rounded-xl p-3 flex-shrink-0">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <Scale className="w-5 h-5 text-[#B86F26]" />
                                <div>
                                    <p className="font-bold text-[#2B1810] text-sm capitalize">Role: {lawRole}</p>
                                    <p className="text-xs text-[#2B1810]/60">
                                        {callStatus === CallStatus.ACTIVE ? "Active" : callStatus === CallStatus.FINISHED ? "Ended" : "Inactive"}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={callStatus === CallStatus.ACTIVE ? () => vapi.stop() : handleStartSession}
                                className={`px-4 py-2 rounded-lg font-bold text-xs transition-all ${callStatus === CallStatus.ACTIVE
                                        ? "bg-red-600 hover:bg-red-700 text-white"
                                        : "bg-green-600 hover:bg-green-700 text-white"
                                    }`}
                            >
                                {callStatus === CallStatus.ACTIVE ? "End" : "Start Voice"}
                            </button>
                        </div>
                    </div>

                    {/* Chat */}
                    <div className="bg-[#F4D9A6] border-4 border-[#B86F26] rounded-2xl p-4 flex-1 overflow-y-auto shadow-2xl min-h-0">
                        {roleMessages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full p-4">
                                <Scale className="w-16 h-16 text-[#B86F26] mb-4" />
                                <h3 className="font-bold text-[#2B1810] text-lg mb-3 text-center">Session Info</h3>
                                <div className="space-y-2 w-full">
                                    <div className="bg-[#E8C896] rounded-lg p-3 border-2 border-[#B86F26]">
                                        <p className="text-xs font-bold text-[#2B1810] mb-1">Your Role</p>
                                        <p className="text-sm text-[#2B1810] capitalize">{lawRole}</p>
                                    </div>
                                    <div className="bg-[#E8C896] rounded-lg p-3 border-2 border-[#B86F26]">
                                        <p className="text-xs font-bold text-[#2B1810] mb-1">Case</p>
                                        <p className="text-sm text-[#2B1810]">{selectedCase?.title}</p>
                                    </div>
                                    <div className="bg-[#E8C896] rounded-lg p-3 border-2 border-[#B86F26]">
                                        <p className="text-xs font-bold text-[#2B1810] mb-1">Instructions</p>
                                        <p className="text-xs text-[#2B1810] leading-relaxed">
                                            Type arguments. AI will respond emotionally based on your role.
                                        </p>
                                    </div>
                                    {callStatus === CallStatus.FINISHED && (
                                        <button
                                            onClick={downloadSessionPDF}
                                            className="w-full py-3 bg-[#FF8C42] hover:bg-[#D4761F] text-white font-bold rounded-lg transition-all shadow-lg flex items-center justify-center gap-2"
                                        >
                                            <Download className="w-4 h-4" />
                                            Download Session PDF
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {roleMessages
                                    .slice()
                                    .reverse()
                                    .map((msg, i) => (
                                        <div
                                            key={i}
                                            className={`p-3 rounded-xl shadow-md transition-all ${msg.role === lawRole ? "bg-[#FF8C42] text-white ml-4" : "bg-[#E8C896] text-[#2B1810] mr-4"
                                                }`}
                                        >
                                            <p className="text-xs font-bold uppercase opacity-70 mb-1">{msg.role}</p>
                                            <p className="text-xs md:text-sm leading-relaxed">{msg.content}</p>
                                        </div>
                                    ))}
                                {isGeneratingAI && (
                                    <div className="text-center py-2">
                                        <p className="text-[#FF8C42] font-semibold animate-pulse text-xs">AI responding...</p>
                                    </div>
                                )}
                                {callStatus === CallStatus.FINISHED && (
                                    <div className="sticky bottom-0 pt-2">
                                        <button
                                            onClick={downloadSessionPDF}
                                            className="w-full py-3 bg-[#FF8C42] hover:bg-[#D4761F] text-white font-bold rounded-lg transition-all shadow-lg flex items-center justify-center gap-2"
                                        >
                                            <Download className="w-4 h-4" />
                                            Download Session PDF
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Input */}
                    <div className="flex gap-2 flex-shrink-0">
                        <input
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                            placeholder="Type your argument..."
                            className="flex-1 px-3 py-2 bg-[#F4D9A6] border-2 border-[#B86F26] rounded-xl text-xs md:text-sm font-semibold text-[#2B1810] placeholder:text-[#2B1810]/50 focus:outline-none focus:ring-2 focus:ring-[#FF8C42]"
                        />
                        <button
                            onClick={sendMessage}
                            className="px-4 py-2 bg-[#FF8C42] hover:bg-[#D4761F] text-white rounded-xl font-bold transition-all shadow-lg"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom: Case Info */}
            {selectedCase && (
                <div className="bg-[#B86F26] border-t-4 border-[#FF8C42] p-3 flex-shrink-0 shadow-2xl">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                        <div className="flex-1">
                            <h3 className="text-base md:text-lg font-bold text-[#F4D9A6] mb-1">{selectedCase.title}</h3>
                            <p className="text-xs md:text-sm text-[#F4D9A6]/90 mb-2 line-clamp-1">{selectedCase.description}</p>
                            <div className="flex gap-2 flex-wrap">
                                {selectedCase.applicableSections.map((sec, i) => (
                                    <span key={i} className="px-3 py-1 bg-[#2B1810] text-[#FF8C42] rounded-full text-xs font-bold border-2 border-[#FF8C42]">
                                        IPC {sec}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2 items-center flex-wrap">
                            <input
                                value={ipcInput}
                                onChange={(e) => setIpcInput(e.target.value)}
                                placeholder="Enter IPC..."
                                className="px-3 py-2 rounded-lg bg-[#F4D9A6] text-[#2B1810] font-semibold border-2 border-[#2B1810] w-32 text-xs focus:outline-none focus:ring-2 focus:ring-[#FF8C42]"
                            />
                            <button className="px-4 py-2 bg-[#FF8C42] hover:bg-[#D4761F] text-white font-bold rounded-lg transition-all shadow-lg text-xs">
                                Validate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Subtitles */}
            {callStatus === CallStatus.ACTIVE && latestAssistantMessage && (
                <div className="bg-black/90 border-t-4 border-[#FF8C42] p-3 flex-shrink-0 backdrop-blur-sm">
                    <div className="max-w-6xl mx-auto flex items-center gap-3">
                        <div className="bg-[#FF8C42] p-2 rounded-full animate-pulse">
                            <Scale className="w-4 h-4 md:w-5 md:h-5 text-white" />
                        </div>
                        <div className="flex-1">
                            <p className="text-xs text-[#FF8C42] font-bold mb-1">AI SPEAKING - {lawRole.toUpperCase()}</p>
                            <p className="text-white text-sm md:text-base font-semibold line-clamp-2">{latestAssistantMessage}</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
