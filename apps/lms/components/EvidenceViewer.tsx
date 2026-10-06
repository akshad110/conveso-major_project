"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { Evidence } from "@/constants/lawCases";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface EvidenceViewerProps {
    evidence: Evidence[];
    isOpen: boolean;
    onClose: () => void;
    currentIndex: number;
    onNavigate: (index: number) => void;
    isJudge?: boolean;
}

export default function EvidenceViewer({
    evidence,
    isOpen,
    onClose,
    currentIndex,
    onNavigate,
    isJudge = false,
}: EvidenceViewerProps) {
    const currentEvidence = evidence[currentIndex];

    if (!isOpen || !currentEvidence) return null;

    const nextEvidence = () => {
        if (currentIndex < evidence.length - 1) {
            onNavigate(currentIndex + 1);
        }
    };

    const prevEvidence = () => {
        if (currentIndex > 0) {
            onNavigate(currentIndex - 1);
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.8, rotateY: -15 }}
                    animate={{ scale: 1, rotateY: 0 }}
                    exit={{ scale: 0.8, rotateY: 15 }}
                    transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 25,
                    }}
                    className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden relative"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        transformStyle: "preserve-3d",
                        perspective: "1000px",
                    }}
                >
                    {/* Book spine effect */}
                    <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-amber-800 to-amber-600 shadow-inner" />

                    {/* Close button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 z-10 p-2 bg-black/20 hover:bg-black/40 rounded-full transition-colors"
                    >
                        <X className="w-6 h-6 text-white" />
                    </button>

                    <div className="flex flex-col h-full pl-8 pr-4 py-6">
                        {/* Evidence header */}
                        <div className="mb-4 border-b-2 border-amber-800 pb-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-amber-900 font-semibold mb-1">
                                        EVIDENCE {currentEvidence.id.toUpperCase()}
                                    </p>
                                    <h2 className="text-2xl font-bold text-amber-950">
                                        {currentEvidence.title}
                                    </h2>
                                    <p className="text-sm text-amber-800 mt-1 capitalize">
                                        {currentEvidence.type}
                                    </p>
                                </div>
                                <div className="text-sm text-amber-700">
                                    {currentIndex + 1} of {evidence.length}
                                </div>
                            </div>
                        </div>

                        {/* Evidence content */}
                        <div className="flex-1 overflow-y-auto">
                            {currentEvidence.imagePath && (
                                <motion.div
                                    initial={isJudge ? { opacity: 0, y: 20 } : {}}
                                    animate={isJudge ? { opacity: 1, y: 0 } : {}}
                                    transition={isJudge ? { delay: 0.3, duration: 0.5 } : {}}
                                    className="mb-4 rounded-lg overflow-hidden border-4 border-amber-900 shadow-lg bg-white"
                                >
                                    <div className="relative w-full h-80">
                                        <Image
                                            src={currentEvidence.imagePath}
                                            alt={currentEvidence.title}
                                            fill
                                            className="object-contain p-4"
                                        />
                                    </div>
                                </motion.div>
                            )}

                            <motion.div
                                initial={isJudge ? { opacity: 0 } : {}}
                                animate={isJudge ? { opacity: 1 } : {}}
                                transition={isJudge ? { delay: 0.6, duration: 0.5 } : {}}
                                className="bg-white/70 p-6 rounded-lg border-2 border-amber-700 shadow-inner"
                            >
                                <h3 className="font-bold text-amber-950 mb-3 text-lg">
                                    Evidence Description
                                </h3>
                                <p className="text-amber-900 leading-relaxed">
                                    {currentEvidence.description}
                                </p>
                            </motion.div>
                        </div>

                        {/* Navigation */}
                        <div className="flex items-center justify-between mt-6 pt-4 border-t-2 border-amber-800">
                            <button
                                onClick={prevEvidence}
                                disabled={currentIndex === 0}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${currentIndex === 0
                                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                        : "bg-amber-700 text-white hover:bg-amber-800 shadow-md"
                                    }`}
                            >
                                <ChevronLeft className="w-5 h-5" />
                                Previous
                            </button>

                            <div className="flex gap-2">
                                {evidence.map((_, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => onNavigate(idx)}
                                        className={`w-3 h-3 rounded-full transition-all ${idx === currentIndex
                                                ? "bg-amber-800 w-8"
                                                : "bg-amber-400 hover:bg-amber-600"
                                            }`}
                                    />
                                ))}
                            </div>

                            <button
                                onClick={nextEvidence}
                                disabled={currentIndex === evidence.length - 1}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${currentIndex === evidence.length - 1
                                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                                        : "bg-amber-700 text-white hover:bg-amber-800 shadow-md"
                                    }`}
                            >
                                Next
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
