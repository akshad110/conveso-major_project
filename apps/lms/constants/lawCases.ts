// Law case scenarios for courtroom simulation

export interface Evidence {
    id: string;
    title: string;
    description: string;
    type: "document" | "photo" | "physical" | "testimony";
    imagePath?: string;
}

export interface LawCase {
    id: string;
    title: string;
    category: "murder" | "alimony" | "theft" | "assault" | "fraud";
    description: string;
    background: string;
    evidence: Evidence[];
    applicableSections: string[];
    difficulty: "easy" | "medium" | "hard";
}

export const lawCases: LawCase[] = [
    {
        id: "murder-case-001",
        title: "State vs. Rajesh Kumar - Murder Case",
        category: "murder",
        difficulty: "medium",
        description: "A case of alleged premeditated murder where the accused is charged with killing his business partner over a financial dispute.",
        background: `On the night of March 15, 2024, the victim, Mr. Vikram Sharma (45), was found dead in his office with multiple stab wounds. 
    The accused, Rajesh Kumar (42), was his business partner for 8 years. According to witnesses, they had a heated argument earlier that day 
    regarding the dissolution of their partnership and division of assets. The accused was seen leaving the office premises around 10:30 PM, 
    shortly before the estimated time of death. A knife matching the murder weapon was found in the accused's car with traces of blood.`,
        evidence: [
            {
                id: "ev-001",
                title: "Murder Weapon",
                description: "A 7-inch kitchen knife with blood stains matching the victim's blood type. Fingerprints of the accused were found on the handle.",
                type: "physical",
                imagePath: "/evidence/murder-weapon.png"
            },
            {
                id: "ev-002",
                title: "Crime Scene Photo",
                description: "Photographs of the crime scene showing the victim's body and signs of struggle in the office.",
                type: "photo",
                imagePath: "/evidence/crime-scene.png"
            },
            {
                id: "ev-003",
                title: "CCTV Footage",
                description: "Security camera footage showing the accused entering the building at 10:15 PM and leaving at 10:32 PM on the night of the murder.",
                type: "document",
                imagePath: "/evidence/cctv-footage.png"
            },
            {
                id: "ev-004",
                title: "Witness Statement - Security Guard",
                description: "Statement from the building's security guard confirming he saw the accused leave the premises in a hurried manner with blood stains on his shirt.",
                type: "testimony",
                imagePath: "/evidence/witness-statement.png"
            },
            {
                id: "ev-005",
                title: "Financial Records",
                description: "Partnership dissolution documents showing a dispute over ₹50 lakhs, revealing a strong financial motive.",
                type: "document",
                imagePath: "/evidence/financial-records.png"
            },
            {
                id: "ev-006",
                title: "Forensic Report",
                description: "Forensic analysis confirming the blood on the knife and the victim's wounds match. Time of death estimated between 10:20-10:30 PM.",
                type: "document",
                imagePath: "/evidence/forensic-report.png"
            }
        ],
        applicableSections: ["302", "34", "201", "307"]
    },
    {
        id: "alimony-case-001",
        title: "Priya Malhotra vs. Arjun Malhotra - Alimony Dispute",
        category: "alimony",
        difficulty: "easy",
        description: "A matrimonial case where the wife is seeking maintenance and alimony after separation from her husband of 12 years.",
        background: `Priya Malhotra (38) filed for maintenance under Section 125 CrPC against her husband Arjun Malhotra (42) after 12 years of marriage. 
    The couple separated in January 2024. Priya alleges that Arjun subjected her to mental cruelty and has failed to provide financial support 
    for her and their two children (ages 8 and 10). Arjun is a successful businessman earning approximately ₹15 lakhs per month. 
    Priya was a homemaker throughout the marriage and has no independent source of income. She is seeking ₹3 lakhs per month as maintenance 
    for herself and the children, along with a lump sum alimony payment.`,
        evidence: [
            {
                id: "ev-a01",
                title: "Marriage Certificate",
                description: "Certificate proving the marriage between Priya and Arjun on June 5, 2012.",
                type: "document",
                imagePath: "/evidence/marriage-certificate.png"
            },
            {
                id: "ev-a02",
                title: "Income Tax Returns",
                description: "Arjun's ITR documents for the last 3 years showing monthly income averaging ₹15 lakhs.",
                type: "document",
                imagePath: "/evidence/income-tax.png"
            },
            {
                id: "ev-a03",
                title: "Children's School Records",
                description: "Admission records and fee receipts for both children, showing educational expenses of ₹1.2 lakhs annually per child.",
                type: "document",
                imagePath: "/evidence/school-records.png"
            },
            {
                id: "ev-a04",
                title: "Medical Records",
                description: "Priya's medical records showing treatment for depression and anxiety following marital discord.",
                type: "document",
                imagePath: "/evidence/medical-records.png"
            },
            {
                id: "ev-a05",
                title: "Witness Statement - Neighbor",
                description: "Testimony from a neighbor confirming frequent arguments and Arjun's abusive behavior towards Priya.",
                type: "testimony",
                imagePath: "/evidence/neighbor-testimony.png"
            },
            {
                id: "ev-a06",
                title: "Bank Statements",
                description: "Priya's bank statements showing no financial support received from Arjun since separation in January 2024.",
                type: "document",
                imagePath: "/evidence/bank-statements.png"
            }
        ],
        applicableSections: ["125 CrPC", "498A", "Section 24 HMA"]
    }
];

export const getCaseById = (id: string): LawCase | undefined => {
    return lawCases.find(c => c.id === id);
};

export const getCasesByCategory = (category: string): LawCase[] => {
    return lawCases.filter(c => c.category === category);
};
