/**
 * What the courtroom monitor knows about each exhibit.
 *
 * This is a display fallback, not a source of truth. The engine sends the title
 * and description with the SHOW_EVIDENCE event and those always win — the case
 * file is the record. What this adds is the part the record has no opinion about:
 * how the exhibit should be *shown*. A fingerprint report is a card of text. The
 * Camera 02 recording is footage, and it should play.
 *
 * Keyed by the exhibit ids in the case file, so a case with different exhibits
 * falls through to a plain card rather than showing the wrong thing.
 */
export const EXHIBITS = {
  EXHIBIT_A: {
    id: 'EXHIBIT_A',
    type: 'physical',
    exhibit: 'Exhibit A',
    title: 'Gold cufflink recovered beside the body',
    body: 'One gold cufflink engraved with the shop’s mark, recovered from the floor about half a metre from the deceased’s right hand. One of a pair the deceased gave the accused in 2023.',
  },
  EXHIBIT_B: {
    id: 'EXHIBIT_B',
    type: 'document',
    exhibit: 'Exhibit B',
    title: 'Post-mortem report, Dr Meera Bhat',
    body: 'A single blunt-force injury to the left parietal region, consistent with the brass carriage clock. Death between 23:45 and 00:15. No defensive injuries.',
  },
  EXHIBIT_C: {
    id: 'EXHIBIT_C',
    type: 'document',
    exhibit: 'Exhibit C',
    title: 'Fingerprint report on the brass carriage clock',
    body: 'Three latent prints on the clock, one on the base by which it would be gripped to strike. All three matched to Gopi Shetty. None of the accused on the striking surface.',
  },
  EXHIBIT_D: {
    id: 'EXHIBIT_D',
    type: 'video',
    // The file is the same footage the cutscene panels were cut from.
    video: '/video/cctv_exhib.mp4',
    exhibit: 'Exhibit D',
    title: 'CCTV recording, Camera 02, Nightingale Road',
    body: 'A man enters at 23:51. The recording fails for six minutes. When it resumes the door is open and the lights are off, and at 23:58:56 a figure of heavier build leaves and walks west.',
  },
  EXHIBIT_E: {
    id: 'EXHIBIT_E',
    type: 'document',
    exhibit: 'Exhibit E',
    title: 'Statement of Gopi Shetty, with amendment sheet',
    body: 'The statement of 12 September describing a second, heavier man in a coat near the door during the darkness — and the amended statement of 14 September from which that man is gone.',
  },
  EXHIBIT_F: {
    id: 'EXHIBIT_F',
    type: 'document',
    exhibit: 'Exhibit F',
    title: 'Recovery panchnama, Patek Philippe 3970',
    body: 'Recovery of the wristwatch said to have been stolen by the accused in June 2025 — from a tin box in the residence of Gopi Shetty, on 14 September 2025.',
  },
  EXHIBIT_G: {
    id: 'EXHIBIT_G',
    type: 'document',
    exhibit: 'Exhibit G',
    title: 'Ledger extract, Chandra Finance',
    body: 'A principal of Rs 4,10,000 outstanding against Gopi Shetty, in arrears since March 2025, with a demand noted in the first week of September.',
  },
}

/**
 * An exhibit by id, or a serviceable card for one this catalogue has never heard
 * of. The monitor must never go blank because a case introduced an exhibit that
 * nobody wrote display copy for.
 */
export function getExhibit(id) {
  if (!id) return null
  return EXHIBITS[id] || {
    id: String(id),
    type: 'document',
    exhibit: String(id).replace(/_/g, ' '),
    title: 'Submitted Evidence',
    body: 'No description on file.',
  }
}
