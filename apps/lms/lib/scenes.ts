/** The deployed 3D rooms. Opened in their own tab from a companion. */
export const COURTROOM_URL = "https://conveso-major-project-2.onrender.com/";
export const CLASSROOM_URL = "https://conveso-major-project-1.onrender.com/";

export const COURT_CASES = [
  {
    id: "state-v-malhotra",
    title: "State versus Dev Malhotra",
    detail: "Online payment fraud: cheating, identity theft, and personation by computer.",
  },
  {
    id: "state-v-rane",
    title: "State versus Kabir Rane",
    detail: "Murder and theft at Thorne's Timepieces.",
  },
] as const;

export const courtroomUrl = (caseId?: string) => {
  const url = new URL(COURTROOM_URL);
  if (caseId) url.searchParams.set("case", caseId);
  return url.toString();
};
