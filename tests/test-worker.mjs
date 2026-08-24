/* Unit-Tests der Erinnerungslogik im Push-Worker */
import { dueKind, normTimes, hhmmToMin, timeForKind, DEFAULT_TIMES, WINDOW_MIN }
  from "../worker/worker.js";

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const TODAY = "2026-08-20";           // Donnerstag
const at = hhmm => ({ date: TODAY, min: hhmmToMin(hhmm), isoWeekday: 4 });

// Abo-Grundgeruest; ueber `over` einzelne Felder ueberschreiben
const rec = over => Object.assign({
  subscription: { endpoint: "x" },
  lastLogged: null,
  workdays: [1, 2, 3, 4, 5],
  times: { ...DEFAULT_TIMES },        // 07:45 / 12:35 / 15:45 / 20:00
  status: null,
  sent: null
}, over || {});

const status = (o) => Object.assign({ date: TODAY, hasStart: false, hasBreak: false, hasEnd: false }, o);

console.log("\nA) Zeit-Hilfsfunktionen");
check("hhmmToMin 07:45", hhmmToMin("07:45") === 465);
check("hhmmToMin 00:00", hhmmToMin("00:00") === 0);
check("hhmmToMin leer -> null", hhmmToMin("") === null);
check("hhmmToMin Unsinn -> null", hhmmToMin("25:99") === null);
check("normTimes filtert Ungültiges", JSON.stringify(normTimes({ start: "07:45", pause: "", end: "abc", endFri: "", day: "20:00" }))
  === JSON.stringify({ start: "07:45", pause: "", end: "", endFri: "", day: "20:00" }));
check("normTimes ohne Objekt -> null", normTimes(null) === null);

console.log("\nB) Arbeitsbeginn");
check("07:45, nichts erfasst -> start", dueKind(rec(), at("07:45")) === "start");
check("07:50, noch im Fenster -> start", dueKind(rec(), at("07:50")) === "start");
check("07:44, noch zu früh -> nichts", dueKind(rec(), at("07:44")) === null);
check("08:15, Fenster (30 Min) vorbei -> nichts", dueKind(rec(), at("08:15")) === null);
check("bereits gestempelt -> nichts",
  dueKind(rec({ status: status({ hasStart: true }) }), at("07:45")) === null);
check("heute schon erinnert -> nichts",
  dueKind(rec({ sent: { date: TODAY, kinds: ["start"] } }), at("07:45")) === null);
check("gestern erinnert zählt nicht -> start",
  dueKind(rec({ sent: { date: "2026-08-19", kinds: ["start"] } }), at("07:45")) === "start");
check("Status von gestern zählt nicht -> start",
  dueKind(rec({ status: status({ date: "2026-08-19", hasStart: true }) }), at("07:45")) === "start");
check("Tag bereits komplett erfasst -> nichts",
  dueKind(rec({ lastLogged: TODAY }), at("07:45")) === null);

console.log("\nC) Pause");
check("12:35, im Dienst ohne Pause -> pause",
  dueKind(rec({ status: status({ hasStart: true }) }), at("12:35")) === "pause");
check("Pause schon erfasst -> nichts",
  dueKind(rec({ status: status({ hasStart: true, hasBreak: true }) }), at("12:35")) === null);
check("Tag schon beendet (z. B. Freitag 12:30) -> nichts",
  dueKind(rec({ status: status({ hasStart: true, hasEnd: true }) }), at("12:35")) === null);
check("gar nicht gestempelt -> keine Pausenerinnerung",
  dueKind(rec(), at("12:35")) === null);

console.log("\nD) Feierabend");
check("15:45, im Dienst -> end",
  dueKind(rec({ status: status({ hasStart: true }) }), at("15:45")) === "end");
check("Ende schon gestempelt -> nichts",
  dueKind(rec({ status: status({ hasStart: true, hasEnd: true }) }), at("15:45")) === null);
check("nie gestempelt -> keine Feierabenderinnerung",
  dueKind(rec(), at("15:45")) === null);

console.log("\nE) Tagescheck 20 Uhr");
check("20:00, nichts erfasst -> day", dueKind(rec(), at("20:00")) === "day");
check("20:00, Tag erfasst -> nichts", dueKind(rec({ lastLogged: TODAY }), at("20:00")) === null);
check("20:00, nur Beginn gestempelt -> day (Ende fehlt)",
  dueKind(rec({ status: status({ hasStart: true }) }), at("20:00")) === "day");

console.log("\nF) Abgeschaltete Anlässe");
const off = { start: "", pause: "", end: "", day: "20:00" };
check("Beginn aus -> nichts um 07:45", dueKind(rec({ times: off }), at("07:45")) === null);
check("Tagescheck bleibt aktiv", dueKind(rec({ times: off }), at("20:00")) === "day");
check("alles aus -> nie etwas",
  dueKind(rec({ times: { start: "", pause: "", end: "", day: "" } }), at("20:00")) === null);

console.log("\nG) Überlappende Zeiten: der spätere Anlass gewinnt");
check("Beginn und Pause gleichzeitig fällig -> pause",
  dueKind(rec({ times: { start: "12:35", pause: "12:35", end: "", day: "" }, status: status({ hasStart: true }) }), at("12:35")) === "pause");

console.log("\nH) Fensterbreite");
check("WINDOW_MIN ist 30", WINDOW_MIN === 30);
check("exakt am Fensterrand (+29) -> start", dueKind(rec(), at("08:14")) === "start");

console.log("\nI) Eigener Feierabend am Freitag");
{
  const fri = hhmm => ({ date: "2026-08-21", min: hhmmToMin(hhmm), isoWeekday: 5 });
  const thu = hhmm => ({ date: "2026-08-20", min: hhmmToMin(hhmm), isoWeekday: 4 });
  const imDienstDo = status({ hasStart: true });                              // Datum = TODAY (Do)
  const imDienstFr = status({ hasStart: true, date: "2026-08-21" });
  const mitFri  = { start: "07:45", pause: "12:35", end: "15:45", endFri: "12:10", day: "20:00" };
  const ohneFri = { start: "07:45", pause: "12:35", end: "15:45", endFri: "",      day: "20:00" };

  check("Fr 12:10 -> end (Freitagszeit greift)",
    dueKind(rec({ times: mitFri, status: imDienstFr }), fri("12:10")) === "end");
  check("Fr 15:45 -> nichts (Mo–Do-Zeit gilt freitags nicht mehr)",
    dueKind(rec({ times: mitFri, status: imDienstFr }), fri("15:45")) === null);
  check("Do 15:45 -> end (Freitagszeit stört Mo–Do nicht)",
    dueKind(rec({ times: mitFri, status: imDienstDo }), thu("15:45")) === "end");
  check("Do 12:10 -> nichts",
    dueKind(rec({ times: mitFri, status: imDienstDo }), thu("12:10")) === null);
  check("leeres Freitagsfeld -> Mo–Do-Zeit gilt auch freitags",
    dueKind(rec({ times: ohneFri, status: imDienstFr }), fri("15:45")) === "end");
  check("Freitagszeit wirkt nur auf den Feierabend",
    dueKind(rec({ times: mitFri }), fri("07:45")) === "start");
  check("Status vom Vortag zählt auch freitags nicht",
    dueKind(rec({ times: mitFri, status: imDienstDo }), fri("12:10")) === null);
  check("timeForKind: Fr mit endFri", timeForKind("end", mitFri, 5) === "12:10");
  check("timeForKind: Do mit endFri", timeForKind("end", mitFri, 4) === "15:45");
  check("timeForKind: Fr ohne endFri", timeForKind("end", ohneFri, 5) === "15:45");
  check("timeForKind: Beginn unberührt", timeForKind("start", mitFri, 5) === "07:45");
  check("normTimes behält endFri",
    normTimes({ start: "07:45", pause: "", end: "15:45", endFri: "12:10", day: "" }).endFri === "12:10");
  check("normTimes verwirft unsinniges endFri",
    normTimes({ start: "07:45", pause: "", end: "15:45", endFri: "99:99", day: "" }).endFri === "");
}

console.log("\n===== " + pass + " bestanden, " + fail + " fehlgeschlagen =====");
process.exit(fail ? 1 : 0);
