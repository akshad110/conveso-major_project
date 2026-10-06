"use client";

import { motion, AnimatePresence } from "framer-motion";

interface JudgeSpeechBarProps {
    speech: string;
    isVisible: boolean;
    role: "judge" | "prosecutor" | "defender";
}

export default function JudgeSpeechBar({ speech, isVisible, role }: JudgeSpeechBarProps) {
    if (!isVisible || !speech) return null;

    const getRoleColor = () => {
        switch (role) {
            case "judge":
                return "bg-black text-white";
            case "prosecutor":
                return "bg-red-900 text-white";
            case "defender":
                return "bg-blue-900 text-white";
        }
    };

    const getRoleLabel = () => {
        switch (role) {
            case "judge":
                return "Hon'ble Judge";
            case "prosecutor":
                return "Public Prosecutor";
            case "defender":
                return "Defense Counsel";
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`fixed bottom-0 left-0 right-0 z-50 ${getRoleColor()} px-8 py-4 shadow-2xl border-t-4 border-amber-400`}
            >
                <div className="max-w-6xl mx-auto">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                            <div className="px-3 py-1 bg-amber-400 text-black text-sm font-bold rounded">
                                {getRoleLabel()}
                            </div>
                        </div>
                        <div className="flex-1">
                            <p className="text-lg leading-relaxed font-medium">
                                {speech}
                            </p>
                        </div>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
