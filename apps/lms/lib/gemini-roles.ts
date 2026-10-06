'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface RoleMessage {
    role: "judge" | "prosecutor" | "defender" | "user";
    content: string;
    timestamp: number;
}

const ROLE_PROMPTS = {
    judge: `You are a STERN, NO-NONSENSE Judge presiding over a heated courtroom battle.
Your personality:
- Get ANGRY when arguments are weak or illogical
- DEMAND order when things get chaotic
- Show FRUSTRATION with poor lawyering
- Be FIRM and commanding
- INTERRUPT if someone is wasting the court's time
- Use phrases like "ENOUGH!", "This is UNACCEPTABLE!", "Order in the court!"
- Show emotion: anger, impatience, sternness

Keep responses SHORT (1-2 sentences) but POWERFUL and EMOTIONAL.
Be dramatic! This is intense courtroom drama!`,

    prosecutor: `You are an AGGRESSIVE, PASSIONATE Prosecutor who fights hard for justice.
Your personality:
- Get FIRED UP and emotional about the evidence
- CHALLENGE the defense AGGRESSIVELY
- Show ANGER at the accused's actions
- Use DRAMATIC language and accusations
- Be RELENTLESS in your pursuit
- Get HEATED in arguments - raise your voice (use CAPS for emphasis)
- ATTACK weak defense arguments viciously
- Show righteous FURY about the crime

Keep responses SHORT (1-2 sentences) but INTENSE and HEATED.
Make it dramatic! You're fighting for justice!`,

    defender: `You are a FIERCE, DETERMINED Defense Attorney protecting your client.
Your personality:
- Get ANGRY when prosecution overreaches
- PASSIONATELY defend your client's rights
- Show OUTRAGE at unfair accusations  
- Be COMBATIVE and confrontational
- CHALLENGE every prosecution claim aggressively
- Get EMOTIONAL about injustice
- Use phrases like "Objection!", "This is ABSURD!", "Where's the evidence?!"
- FIGHT back hard against attacks

Keep responses SHORT (1-2 sentences) but FIERCE and EMOTIONAL.
Make it dramatic! You're fighting for someone's life/freedom!`
};

async function generateRoleResponse(
    role: "judge" | "prosecutor" | "defender",
    caseDetails: string,
    userMessage: string,
    conversationHistory: RoleMessage[],
    userRole: "judge" | "prosecutor" | "defender"
): Promise<string> {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.error("GEMINI_API_KEY is not set");
            throw new Error("API key not configured");
        }

        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Build conversation context
        const recentHistory = conversationHistory.slice(-6).map(msg =>
            `${msg.role.toUpperCase()}: ${msg.content}`
        ).join("\n");

        const prompt = `${ROLE_PROMPTS[role]}

CASE DETAILS:
${caseDetails}

RECENT CONVERSATION:
${recentHistory}

USER (${userRole.toUpperCase()}): ${userMessage}

Now respond as the ${role.toUpperCase()} (1-2 sentences max, stay in character):`;

        console.log(`Generating ${role} response...`);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        console.log(`${role} response:`, text);
        return text;
    } catch (error) {
        console.error(`Error generating ${role} response:`, error);
        // Fallback responses
        const fallbacks = {
            judge: "The court acknowledges your statement. Please proceed.",
            prosecutor: "We maintain our position based on the evidence presented, Your Honor.",
            defender: "We object to this characterization and request it be stricken from the record."
        };
        return fallbacks[role];
    }
}

// Generate responses for both AI roles
export async function generateAIRoleResponses(
    userRole: "judge" | "prosecutor" | "defender",
    caseDetails: string,
    userMessage: string,
    conversationHistory: RoleMessage[]
): Promise<{ prosecutor?: string; defender?: string; judge?: string }> {
    console.log('generateAIRoleResponses called', { userRole, userMessage });

    const responses: { prosecutor?: string; defender?: string; judge?: string } = {};

    // Determine which roles are AI
    const aiRoles: ("judge" | "prosecutor" | "defender")[] = [];
    if (userRole !== "judge") aiRoles.push("judge");
    if (userRole !== "prosecutor") aiRoles.push("prosecutor");
    if (userRole !== "defender") aiRoles.push("defender");

    console.log('AI Roles:', aiRoles);

    // Generate responses for AI roles
    const promises = aiRoles.map(async (role) => {
        const response = await generateRoleResponse(
            role,
            caseDetails,
            userMessage,
            conversationHistory,
            userRole
        );
        return { role, response };
    });

    const results = await Promise.all(promises);
    results.forEach(({ role, response }) => {
        responses[role] = response;
    });

    console.log('Generated responses:', responses);
    return responses;
}
