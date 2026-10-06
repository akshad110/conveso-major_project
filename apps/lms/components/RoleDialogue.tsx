"use client";

import { motion } from "framer-motion";
import { Gavel, Scale, Shield, User } from "lucide-react";
import { RoleMessage } from "@/lib/gemini-roles";

interface RoleDialogueProps {
    messages: RoleMessage[];
    userRole: "judge" | "prosecutor" | "defender";
}

const getRoleIcon = (role: string) => {
    switch (role) {
        case "judge":
            return <Gavel className="w-5 h-5" />;
        case "prosecutor":
            return <Scale className="w-5 h-5" />;
        case "defender":
            return <Shield className="w-5 h-5" />;
        default:
            return <User className="w-5 h-5" />;
    }
};

const getRoleColor = (role: string) => {
    switch (role) {
        case "judge":
            return { bg: "bg-black", text: "text-white", border: "border-amber-400" };
        case "prosecutor":
            return { bg: "bg-red-900", text: "text-white", border: "border-red-400" };
        case "defender":
            return { bg: "bg-blue-900", text: "text-white", border: "border-blue-400" };
        default:
            return { bg: "bg-gray-700", text: "text-white", border: "border-gray-400" };
    }
};

const getRoleLabel = (role: string) => {
    switch (role) {
        case "judge":
            return "Hon'ble Judge";
        case "prosecutor":
            return "Public Prosecutor";
        case "defender":
            return "Defense Counsel";
        default:
            return "User";
    }
};

export default function RoleDialogue({ messages, userRole }: RoleDialogueProps) {
    return (
        <div className="space-y-4 max-h-[500px] overflow-y-auto p-4 bg-gradient-to-b from-amber-50/50 to-transparent rounded-lg">
            {messages.map((msg, idx) => {
                const colors = getRoleColor(msg.role);
                const isUser = msg.role === "user" || msg.role === userRole;

                return (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                        {!isUser && (
                            <div className={`flex-shrink-0 w-10 h-10 rounded-full ${colors.bg} flex items-center justify-center ${colors.text}`}>
                                {getRoleIcon(msg.role)}
                            </div>
                        )}

                        <div className={`max-w-[75%] ${isUser ? "order-first" : ""}`}>
                            <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-bold ${isUser ? "text-amber-900" : "text-gray-700"}`}>
                                    {getRoleLabel(msg.role)} {isUser && "(You)"}
                                </span>
                                <span className="text-xs text-gray-500">
                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                </span>
                            </div>

                            <div
                                className={`
                  rounded-2xl px-4 py-3 shadow-md border-2
                  ${isUser
                                        ? "bg-amber-100 text-amber-950 border-amber-300 rounded-tr-none"
                                        : `${colors.bg} ${colors.text} ${colors.border} rounded-tl-none`
                                    }
                `}
                            >
                                <p className="text-sm leading-relaxed">{msg.content}</p>
                            </div>
                        </div>

                        {isUser && (
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 flex items-center justify-center text-white">
                                {getRoleIcon(userRole)}
                            </div>
                        )}
                    </motion.div>
                );
            })}

            {messages.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                    <Gavel className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Court proceedings will appear here...</p>
                </div>
            )}
        </div>
    );
}
