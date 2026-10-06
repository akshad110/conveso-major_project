"use client";

import { Gavel, Scale, Shield } from "lucide-react";

interface CourtroomLayoutProps {
    role: "judge" | "prosecutor" | "defender";
}

export default function CourtroomLayout({ role }: CourtroomLayoutProps) {
    return (
        <div className="relative bg-gradient-to-b from-amber-100 via-orange-50 to-amber-50 p-8 rounded-2xl border-4 border-amber-400 shadow-2xl overflow-hidden">
            {/* Decorative courtroom background pattern */}
            <div className="absolute inset-0 opacity-5">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-amber-900 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-1/4 w-24 h-24 bg-orange-900 rounded-full blur-2xl"></div>
                <div className="absolute bottom-0 right-1/4 w-24 h-24 bg-yellow-900 rounded-full blur-2xl"></div>
            </div>

            <div className="relative z-10">
                {/* Court Header */}
                <div className="text-center mb-8">
                    <div className="flex justify-center mb-3">
                        <div className="bg-gradient-to-br from-amber-600 to-amber-800 p-4 rounded-full shadow-lg">
                            <Gavel className="w-10 h-10 text-white" />
                        </div>
                    </div>
                    <h2 className="text-3xl font-bold text-amber-950 tracking-wide">COURTROOM</h2>
                    <p className="text-amber-700 text-sm mt-1 font-semibold">IN SESSION</p>
                </div>

                {/* Judge Position (Top Center) */}
                <div className="flex justify-center mb-6">
                    <div
                        className={`relative px-10 py-6 rounded-2xl transition-all duration-500 shadow-xl ${role === "judge"
                                ? "bg-gradient-to-br from-black via-gray-900 to-black ring-4 ring-amber-400 ring-offset-4 ring-offset-amber-50 scale-105"
                                : "bg-gradient-to-br from-gray-800 to-gray-900 opacity-70 hover:opacity-90"
                            }`}
                    >
                        <div className="flex flex-col items-center gap-3">
                            <div className={`p-3 rounded-full ${role === "judge" ? "bg-amber-500" : "bg-gray-700"}`}>
                                <Gavel className="w-8 h-8 text-white" />
                            </div>
                            <div className="text-center">
                                <p className="text-white font-bold text-xl">JUDGE</p>
                                {role === "judge" && (
                                    <p className="text-amber-300 text-xs mt-1 font-semibold">YOU</p>
                                )}
                            </div>
                        </div>
                        {role === "judge" && (
                            <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full border-4 border-white animate-pulse">
                                <div className="absolute inset-0 bg-green-500 rounded-full animate-ping"></div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Prosecutor and Defender (Bottom Row) */}
                <div className="grid grid-cols-2 gap-8 mb-4">
                    {/* Prosecutor */}
                    <div className="flex justify-center">
                        <div
                            className={`relative px-8 py-5 rounded-xl transition-all duration-500 shadow-lg ${role === "prosecutor"
                                    ? "bg-gradient-to-br from-red-900 via-red-800 to-red-900 ring-4 ring-red-400 ring-offset-4 ring-offset-amber-50 scale-105"
                                    : "bg-gradient-to-br from-red-800 to-red-900 opacity-60 hover:opacity-90"
                                }`}
                        >
                            <div className="flex flex-col items-center gap-2">
                                <div className={`p-2 rounded-full ${role === "prosecutor" ? "bg-red-500" : "bg-red-700"}`}>
                                    <Scale className="w-6 h-6 text-white" />
                                </div>
                                <div className="text-center">
                                    <p className="text-white font-bold">PROSECUTOR</p>
                                    {role === "prosecutor" && (
                                        <p className="text-red-300 text-xs mt-1">YOU</p>
                                    )}
                                </div>
                            </div>
                            {role === "prosecutor" && (
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-white animate-pulse"></div>
                            )}
                        </div>
                    </div>

                    {/* Defender */}
                    <div className="flex justify-center">
                        <div
                            className={`relative px-8 py-5 rounded-xl transition-all duration-500 shadow-lg ${role === "defender"
                                    ? "bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 ring-4 ring-blue-400 ring-offset-4 ring-offset-amber-50 scale-105"
                                    : "bg-gradient-to-br from-blue-800 to-blue-900 opacity-60 hover:opacity-90"
                                }`}
                        >
                            <div className="flex flex-col items-center gap-2">
                                <div className={`p-2 rounded-full ${role === "defender" ? "bg-blue-500" : "bg-blue-700"}`}>
                                    <Shield className="w-6 h-6 text-white" />
                                </div>
                                <div className="text-center">
                                    <p className="text-white font-bold">DEFENDER</p>
                                    {role === "defender" && (
                                        <p className="text-blue-300 text-xs mt-1">YOU</p>
                                    )}
                                </div>
                            </div>
                            {role === "defender" && (
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-white animate-pulse"></div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Witness Stand */}
                <div className="flex justify-center mt-6">
                    <div className="px-6 py-3 bg-gradient-to-r from-amber-700 to-amber-600 rounded-lg shadow-md">
                        <p className="text-amber-100 font-semibold text-sm text-center">WITNESS STAND</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
