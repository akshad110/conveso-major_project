/**
 * The matters this courtroom can open. The engine has a file for each id.
 * Shown before a seat is taken, so both cases are available from one room.
 */
export const CASES = [
  {
    id: 'state-v-malhotra',
    title: 'State versus Dev Malhotra',
    charges: [
      { id: 'CH1', statute: 'BNS s.318(4)', label: 'Cheating and dishonestly inducing delivery of property' },
      { id: 'CH2', statute: 'IT Act s.66C', label: 'Identity theft' },
      { id: 'CH3', statute: 'IT Act s.66D', label: 'Cheating by personation using a computer resource' },
    ],
  },
  {
    id: 'state-v-rane',
    title: 'State versus Kabir Rane',
    charges: [
      { id: 'CH1', statute: 'BNS s.103(1)', label: 'Murder' },
      { id: 'CH2', statute: 'BNS s.305(a)', label: 'Theft in a building used as a place of trade' },
    ],
  },
]

export const caseFromLocation = () => {
  try {
    const id = new URLSearchParams(window.location.search).get('case')
    return CASES.some((matter) => matter.id === id) ? id : CASES[0].id
  } catch {
    return CASES[0].id
  }
}
