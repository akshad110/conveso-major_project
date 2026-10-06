# State versus Kabir Rane — where the story actually lives

This file used to hold a prose draft of the case. It is no longer the story, and
the draft that was here contradicted the trial that now runs, so it has been
replaced with a map rather than left to mislead.

The case is authored in two files, and between them they are the whole of it:

`cases/state-v-rane.json` is the record — the charge, the six people who can be
put in the box (four witnesses, the accused, and the escorting officer), and
Exhibits A through G. Everything the court is allowed to know comes from here.

`cases/state-v-rane.script.json` is the performance — 66 authored beats, every
line of dialogue in the order it is meant to be said. It is a companion file
rather than a key inside the case because `CaseManager.normalise()` whitelists
the keys it accepts and would silently drop an unknown one.

The two cutscenes are not in either file. A cutscene is not a courtroom event,
so it belongs to the frontend: see `courtroom-sim/src/ui/Cutscene.jsx`, whose
six panels are stills cut from the same Camera 02 footage that plays on the
courtroom monitor as Exhibit D.

To read the trial rather than the sources, run it:

    npm run verify      # the whole trial, plus the twelve bridge checks
    npm start           # serve it to the frontend
