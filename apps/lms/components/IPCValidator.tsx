"use client";

import { useState, useEffect } from "react";
import { validateIPCSection } from "@/constants/ipcSections";
import { AlertCircle, CheckCircle } from "lucide-react";

interface IPCValidatorProps {
    onValidSection: (section: string) => void;
    expectedCategory?: string;
}

export default function IPCValidator({ onValidSection, expectedCategory }: IPCValidatorProps) {
    const [inputValue, setInputValue] = useState("");
    const [validation, setValidation] = useState<{
        valid: boolean;
        section?: any;
        suggestions: any[];
    } | null>(null);

    const handleValidate = () => {
        if (!inputValue.trim()) return;

        const result = validateIPCSection(inputValue, expectedCategory);
        setValidation(result);

        if (result.valid && result.section) {
            onValidSection(result.section.section);
        }
    };

    useEffect(() => {
        setValidation(null);
    }, [inputValue]);

    return (
        <div className="space-y-4 bg-amber-50 p-6 rounded-lg border-2 border-amber-200">
            <div>
                <label className="block text-sm font-bold text-amber-900 mb-2">
                    Enter Applicable IPC Section
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleValidate()}
                        placeholder="e.g., 302, 498A, 125 CrPC"
                        className="flex-1 px-4 py-2 rounded-lg border-2 border-amber-300 focus:border-amber-500 focus:outline-none"
                    />
                    <button
                        onClick={handleValidate}
                        className="px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition-colors"
                    >
                        Validate
                    </button>
                </div>
            </div>

            {/* Validation result */}
            {validation && (
                <div className={`p-4 rounded-lg border-2 ${validation.valid
                        ? "bg-green-50 border-green-300"
                        : "bg-red-50 border-red-300"
                    }`}>
                    {validation.valid ? (
                        <div className="flex items-start gap-3">
                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-bold text-green-900 mb-1">
                                    Correct! Section {validation.section.section}
                                </h4>
                                <p className="text-sm text-green-800 mb-1">
                                    <span className="font-semibold">{validation.section.title}</span>
                                </p>
                                <p className="text-xs text-green-700">
                                    {validation.section.description}
                                </p>
                                <p className="text-xs text-green-600 mt-2">
                                    <span className="font-semibold">Punishment:</span> {validation.section.punishment}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <h4 className="font-bold text-red-900 mb-2">
                                    Section not found or incorrect for this case
                                </h4>

                                {validation.suggestions.length > 0 && (
                                    <div className="mt-3">
                                        <p className="text-sm font-semibold text-red-800 mb-2">
                                            Did you mean:
                                        </p>
                                        <div className="space-y-2">
                                            {validation.suggestions.map((suggestion, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => {
                                                        setInputValue(suggestion.section);
                                                        setValidation(null);
                                                    }}
                                                    className="w-full text-left p-3 bg-white rounded-lg border border-red-200 hover:border-red-400 hover:bg-red-50 transition-colors"
                                                >
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="font-bold text-red-900">
                                                            Section {suggestion.section}
                                                        </span>
                                                        <span className="text-xs bg-red-200 text-red-800 px-2 py-1 rounded">
                                                            {suggestion.category}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-red-800 font-medium">
                                                        {suggestion.title}
                                                    </p>
                                                    <p className="text-xs text-red-600 mt-1">
                                                        {suggestion.punishment}
                                                    </p>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
