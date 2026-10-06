// Common IPC (Indian Penal Code) Sections for legal case simulation

export interface IPCSection {
    section: string;
    title: string;
    description: string;
    category: "murder" | "theft" | "assault" | "fraud" | "family" | "general";
    punishment: string;
}

export const ipcSections: IPCSection[] = [
    // Murder-related sections
    {
        section: "302",
        title: "Punishment for murder",
        description: "Whoever commits murder shall be punished with death or imprisonment for life, and shall also be liable to fine.",
        category: "murder",
        punishment: "Death or life imprisonment + fine"
    },
    {
        section: "300",
        title: "Murder",
        description: "Culpable homicide is murder if the act is done with the intention of causing death.",
        category: "murder",
        punishment: "Defined offense"
    },
    {
        section: "304",
        title: "Punishment for culpable homicide not amounting to murder",
        description: "Whoever commits culpable homicide not amounting to murder shall be punished with imprisonment for life or up to 10 years with fine.",
        category: "murder",
        punishment: "Life imprisonment or up to 10 years + fine"
    },
    {
        section: "307",
        title: "Attempt to murder",
        description: "Whoever does any act with such intention or knowledge, and under such circumstances that, if he by that act caused death, he would be guilty of murder.",
        category: "murder",
        punishment: "Up to 10 years + fine"
    },

    // Family/Alimony related sections
    {
        section: "125 CrPC",
        title: "Order for maintenance of wives, children and parents",
        description: "Magistrate may order maintenance to wife, legitimate/illegitimate children, and parents unable to maintain themselves.",
        category: "family",
        punishment: "Civil remedy - maintenance order"
    },
    {
        section: "498A",
        title: "Husband or relative of husband subjecting a woman to cruelty",
        description: "Whoever, being the husband or the relative of the husband of a woman, subjects such woman to cruelty.",
        category: "family",
        punishment: "Up to 3 years + fine"
    },
    {
        section: "494",
        title: "Marrying again during lifetime of husband or wife",
        description: "Whoever, having a husband or wife living, marries in any case in which such marriage is void by reason of its taking place during the life of such husband or wife.",
        category: "family",
        punishment: "Up to 7 years + fine"
    },

    // Theft and property crimes
    {
        section: "378",
        title: "Theft",
        description: "Whoever, intending to take dishonestly any moveable property out of the possession of any person without that person's consent.",
        category: "theft",
        punishment: "Up to 3 years or fine or both"
    },
    {
        section: "379",
        title: "Punishment for theft",
        description: "Whoever commits theft shall be punished with imprisonment up to three years, or with fine, or with both.",
        category: "theft",
        punishment: "Up to 3 years or fine or both"
    },
    {
        section: "380",
        title: "Theft in dwelling house",
        description: "Whoever commits theft in any building, tent or vessel used as a human dwelling.",
        category: "theft",
        punishment: "Up to 7 years + fine"
    },

    // Assault and harm
    {
        section: "323",
        title: "Punishment for voluntarily causing hurt",
        description: "Whoever causes hurt shall be punished with imprisonment up to one year, or with fine up to one thousand rupees, or both.",
        category: "assault",
        punishment: "Up to 1 year or ₹1000 fine or both"
    },
    {
        section: "324",
        title: "Voluntarily causing hurt by dangerous weapons or means",
        description: "Whoever causes hurt by means of any instrument for shooting, stabbing or cutting, or any instrument which, used as weapon of offence.",
        category: "assault",
        punishment: "Up to 3 years or fine or both"
    },
    {
        section: "326",
        title: "Voluntarily causing grievous hurt by dangerous weapons or means",
        description: "Whoever causes grievous hurt by means of dangerous weapons or by means which are likely to cause death.",
        category: "assault",
        punishment: "Life imprisonment or up to 10 years + fine"
    },

    // Fraud and cheating
    {
        section: "420",
        title: "Cheating and dishonestly inducing delivery of property",
        description: "Whoever cheats and thereby dishonestly induces the person deceived to deliver any property.",
        category: "fraud",
        punishment: "Up to 7 years + fine"
    },
    {
        section: "406",
        title: "Punishment for criminal breach of trust",
        description: "Whoever commits criminal breach of trust shall be punished with imprisonment up to three years, or with fine, or with both.",
        category: "fraud",
        punishment: "Up to 3 years or fine or both"
    },

    // General sections
    {
        section: "34",
        title: "Acts done by several persons in furtherance of common intention",
        description: "When a criminal act is done by several persons in furtherance of the common intention of all, each is liable as if done by him alone.",
        category: "general",
        punishment: "As per the main offense"
    },
    {
        section: "120B",
        title: "Punishment of criminal conspiracy",
        description: "Whoever is a party to a criminal conspiracy to commit an offense punishable with death, imprisonment for life or rigorous imprisonment.",
        category: "general",
        punishment: "As per the offense conspired"
    },
];

// Helper function to find IPC section
export const findIPCSection = (sectionNumber: string): IPCSection | undefined => {
    const normalized = sectionNumber.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    return ipcSections.find(s => s.section.replace(/[^0-9A-Z]/g, '') === normalized);
};

// Helper function to suggest similar IPC sections
export const suggestIPCSections = (sectionNumber: string, category?: string): IPCSection[] => {
    if (!sectionNumber) return [];

    const normalized = sectionNumber.toLowerCase();
    const suggestions = ipcSections.filter(s => {
        const sectionMatch = s.section.toLowerCase().includes(normalized) ||
            s.title.toLowerCase().includes(normalized);
        const categoryMatch = !category || s.category === category;
        return sectionMatch && categoryMatch;
    });

    return suggestions.slice(0, 5);
};

// Validate IPC section
export const validateIPCSection = (sectionNumber: string, expectedCategory?: string): {
    valid: boolean;
    section?: IPCSection;
    suggestions: IPCSection[];
} => {
    const section = findIPCSection(sectionNumber);

    if (section && (!expectedCategory || section.category === expectedCategory)) {
        return { valid: true, section, suggestions: [] };
    }

    return {
        valid: false,
        suggestions: suggestIPCSections(sectionNumber, expectedCategory)
    };
};
