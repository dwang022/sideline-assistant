import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Volume2, ListChecks, Flag, Clock, Target, Grid3x3, X, History, Trash2, AlertCircle } from "lucide-react";

/* ============================================================================
   PERSISTENCE SHIM
   ----------------------------------------------------------------------------
   The call log lives in React state so the app is fully functional with no
   network. To make the log survive reloads in YOUR deployment, set
   USE_LOCAL_STORAGE = true. (Browser storage is disabled inside the Claude.ai
   artifact sandbox, so it stays off here and the log is session-only.)
   Everything below is written against this shim — flipping the flag is the
   only change needed to get durable, offline-first persistence.
   ========================================================================== */
const USE_LOCAL_STORAGE = false; // flip to true in production deployment
const LOG_KEY = "sideline_call_log_v1";

const store = {
  load() {
    if (!USE_LOCAL_STORAGE) return null;
    try {
      const raw = window.localStorage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  save(log) {
    if (!USE_LOCAL_STORAGE) return false;
    try {
      window.localStorage.setItem(LOG_KEY, JSON.stringify(log));
      return true;
    } catch { return false; }
  },
};

/* ============================================================================
   PFF SIDELINE ASSISTANT
   Voice-driven decision tool encoding three PFF charts:
     1. Two-Point Conversion Chart
     2. Penalty Accept / Decline
     3. Late Half / Game Management
   ----------------------------------------------------------------------------
   All chart logic is digitized below. Color semantics:
     GO2    = Go For 2 (solid green)
     LEAN2  = Lean Go For 2 (light green / hatched green)
     TOSS   = Coin flip / chart-edge (yellow / orange / dotted)
     LEAN1  = Lean Go For 1 (orange)
     GO1    = Go For 1 (dark red)
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1) TWO-POINT CONVERSION CHART
   Rows: TD differential = YOUR score minus OPP score AFTER you score the TD
         but BEFORE the extra point (range +26 .. -26).
   Cols: time buckets.
   Each cell is a recommendation code. Digitized from the PFF chart.
--------------------------------------------------------------------------- */
const TWO_PT_COLS = [
  { key: "H1",   label: "1st Half" },
  { key: "Q3",   label: "Q3" },
  { key: "Q4_15", label: "Q4 15:00" },
  { key: "Q4_10", label: "Q4 10:00" },
  { key: "Q4_5",  label: "Q4 5:00" },
  { key: "Q4_3",  label: "Q4 3:00" },
  { key: "Q4_1",  label: "Q4 1:00" },
];

// Differentials from +26 down to -26 (53 rows).
const TWO_PT_DIFFS = [];
for (let d = 26; d >= -26; d--) TWO_PT_DIFFS.push(d);

/* FIVE-TIER digitization, read from the high-res PFF chart.
   The legend is a confidence gradient, Go For 2 (left) -> Go For 1 (right):
     2   = dark green + dots               -> Strong GO FOR 2
     L2  = light green + hatch             -> Lean go for 2
     T   = yellow                          -> True toss-up (coin flip)
     L1  = peach / orange (merged)         -> Lean kick (chart's default fill)
     1   = dark red + triangles            -> Strong KICK (go for 1)
   Peach and bright-orange are merged into one LEAN KICK tier.
   Confidence = distance from the yellow (T) center of the scale.
   Rows +26 -> -26.  Cols: H1, Q3, Q4_15, Q4_10, Q4_5, Q4_3, Q4_1.
   (WK1 cells below are still read as the peach shade and map to LEAN KICK.) */
const TWO_PT_GRID = {
  26:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  25:["WK1","WK1","WK1","WK1","WK1","WK1","L1"],
  24:["WK1","WK1","WK1","WK1","WK1","WK1","T"],
  23:["L2","L2","L2","L2","L2","L2","WK1"],
  22:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  21:[1,1,1,1,1,1,"WK1"],
  20:["L2","L2","L2","L2","L2","L2","L2"],
  19:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  18:["WK1","WK1","WK1","WK1","WK1","WK1",1],
  17:["WK1","WK1","WK1","WK1","WK1","WK1","L2"],
  16:["L2","L2","L2","L2","L2","L2","WK1"],
  15:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  14:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  13:["L2","L2","2","2","2","2","L2"],
  12:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  11:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  10:["WK1","WK1","WK1","WK1","WK1","WK1","2"],
  9:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  8:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  7:[1,1,1,1,1,1,"WK1"],
  6:["WK1","L2","2","2","2","2","2"],
  5:["WK1",1,1,1,1,1,1],
  4:["WK1","WK1","WK1","WK1","WK1","WK1",1],
  3:["WK1","WK1","WK1","WK1","WK1","WK1","2"],
  2:[1,1,1,1,1,1,1],
  1:["WK1","WK1","WK1","WK1","WK1","WK1","WK1"],
  0:[1,1,1,1,1,1,"WK1"],
  [-1]:["L2","2","2","2","2","2","2"],
  [-2]:["WK1","WK1","L2","2","2","2","2"],
  [-3]:[1,1,1,1,1,1,1],
  [-4]:[1,1,1,1,1,1,1],
  [-5]:["L2","2",1,1,1,1,"T"],
  [-6]:[1,1,1,1,1,1,1],
  [-7]:[1,1,1,1,1,1,1],
  [-8]:["L2","2","2","2","2","2","2"],
  [-9]:[1,1,1,1,1,1,1],
  [-10]:[1,1,1,1,1,1,1],
  [-11]:["L2","2","2","2","2","2","2"],
  [-12]:["WK1","WK1","WK1","WK1","WK1","WK1","2"],
  [-13]:[1,1,1,1,1,1,1],
  [-14]:["WK1","L2","L2","L2","2","2","2"],
  [-15]:["WK1","L2","L2","L2","2","2","WK1"],
  [-16]:["WK1","2","2","2","2","2","1"],
  [-17]:["WK1","WK1","WK1","WK1","WK1","2","2"],
  [-18]:["WK1","2","2","2","2","2","2"],
  [-19]:["L2","2","2","2","2","2","2"],
  [-20]:["WK1",1,1,1,"2","2","2"],
  [-21]:["WK1",1,1,1,1,1,"2"],
  [-22]:["WK1","L2","L2","L2","2","2","2"],
  [-23]:["WK1","L2","L2","L2","L2","WK1",1],
  [-24]:["L2","2","2","2","2","2",1],
  [-25]:["WK1","L2","L2","L2","L2","L2","2"],
  [-26]:["WK1","L2","L2","L2","L2","L2","2"],
};

const REC_META = {
  "2":   { text: "GO FOR 2",       cls: "go2",   tier: "Strong",     blurb: "Take the two. The numbers are firmly behind it." },
  "L2":  { text: "LEAN GO FOR 2",  cls: "lean2", tier: "Lean",       blurb: "Two is favored, but it's close. Factor in your matchup." },
  "T":   { text: "TOSS-UP",        cls: "toss",  tier: "Coin flip",  blurb: "Dead even. Go with your gut, the matchup, or your kicker." },
  "WK1": { text: "LEAN KICK (XP)", cls: "lean1", tier: "Lean",       blurb: "Kicking is favored, but it's close." },
  "L1":  { text: "LEAN KICK (XP)", cls: "lean1", tier: "Lean",       blurb: "Kicking is favored, but it's close." },
  "1":   { text: "KICK THE XP",    cls: "go1",   tier: "Strong",     blurb: "Kick the extra point. The numbers are firmly behind it." },
};

/* ---------------------------------------------------------------------------
   2) PENALTY ACCEPT / DECLINE
   Keyed by the resulting down & distance of the PLAY (the play you'd keep
   if you DECLINE). If the actual play result is at or worse than the
   "decline when" threshold for that penalty, decline; otherwise accept.
   Stored as: for a given penalty (offense/defense), the decline threshold.
--------------------------------------------------------------------------- */
const PENALTY_OFFENSE = [
  { pen: "1 and 5",  declineAt: null }, // never decline
  { pen: "1 and 10", declineAt: { down: 2, dist: 3 } },
  { pen: "1 and 15", declineAt: { down: 2, dist: 7 } },
  { pen: "1 and 20", declineAt: { down: 2, dist: 11 } },
  { pen: "2 and 1",  declineAt: null }, { pen: "2 and 2", declineAt: null },
  { pen: "2 and 3",  declineAt: null }, { pen: "2 and 4", declineAt: null },
  { pen: "2 and 5",  declineAt: null }, { pen: "2 and 6", declineAt: null },
  { pen: "2 and 7",  declineAt: null }, { pen: "2 and 8", declineAt: null },
  { pen: "2 and 9",  declineAt: null },
  { pen: "2 and 10", declineAt: { down: 3, dist: 1 } },
  { pen: "2 and 11", declineAt: { down: 3, dist: 2 } },
  { pen: "2 and 12", declineAt: { down: 3, dist: 3 } },
  { pen: "2 and 13", declineAt: { down: 3, dist: 3 } },
  { pen: "2 and 14", declineAt: { down: 3, dist: 4 } },
  { pen: "2 and 15", declineAt: { down: 3, dist: 4 } },
  { pen: "2 and 16", declineAt: { down: 3, dist: 5 } },
  { pen: "2 and 17", declineAt: { down: 3, dist: 5 } },
  { pen: "2 and 18", declineAt: { down: 3, dist: 6 } },
  { pen: "2 and 19", declineAt: { down: 3, dist: 7 } },
  { pen: "2 and 20", declineAt: { down: 3, dist: 8 } },
  { pen: "2 and 21", declineAt: { down: 3, dist: 8 } },
  { pen: "2 and 22", declineAt: { down: 3, dist: 9 } },
  { pen: "2 and 23", declineAt: { down: 3, dist: 9 } },
  { pen: "2 and 24", declineAt: { down: 3, dist: 9 } },
  { pen: "2 and 25", declineAt: { down: 3, dist: 9 } },
];
const PENALTY_DEFENSE = [
  { pen: "1 and 10", declineAt: { down: 2, dist: 7 } },
  { pen: "1 and 15", declineAt: { down: 2, dist: 12 } },
  { pen: "1 and 20", declineAt: { down: 2, dist: 18 } },
  { pen: "1 and 25", declineAt: { down: 2, dist: 23 } },
  { pen: "2 and 6",  declineAt: { down: 3, dist: 2 } },
  { pen: "2 and 7",  declineAt: { down: 3, dist: 3 } },
  { pen: "2 and 8",  declineAt: { down: 3, dist: 3 } },
  { pen: "2 and 9",  declineAt: { down: 3, dist: 4 } },
  { pen: "2 and 10", declineAt: { down: 3, dist: 7 } },
  { pen: "2 and 11", declineAt: { down: 3, dist: 7 } },
  { pen: "2 and 12", declineAt: { down: 3, dist: 9 } },
  { pen: "2 and 13", declineAt: { down: 3, dist: 10 } },
  { pen: "2 and 14", declineAt: { down: 3, dist: 10 } },
  { pen: "2 and 15", declineAt: { down: 3, dist: 10 } },
  { pen: "2 and 16", declineAt: { down: 3, dist: 10 } },
  { pen: "2 and 17", declineAt: { down: 3, dist: 10 } },
  { pen: "2 and 18", declineAt: { down: 3, dist: 11 } },
  { pen: "2 and 19", declineAt: { down: 3, dist: 12 } },
  { pen: "2 and 20", declineAt: { down: 3, dist: 13 } },
  { pen: "2 and 21", declineAt: { down: 3, dist: 14 } },
  { pen: "2 and 22", declineAt: { down: 3, dist: 15 } },
  { pen: "2 and 23", declineAt: { down: 3, dist: 16 } },
  { pen: "2 and 24", declineAt: { down: 3, dist: 16 } },
  { pen: "2 and 25", declineAt: { down: 3, dist: 17 } },
];

/* ---------------------------------------------------------------------------
   3) LATE HALF / GAME MANAGEMENT
   Rows: time on clock when the 1st-down play is run (5:00 .. 0:05, 5s steps).
   Cols: opponent timeouts remaining (0,1,2,3).
   Each cell -> a category. We classify the cell into the management band.
--------------------------------------------------------------------------- */
// Build the time list 5:00 down to 0:05 in 5-second steps.
const LGM_TIMES = [];
for (let t = 300; t >= 5; t -= 5) LGM_TIMES.push(t);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* Each row of the source maps a "time when 1st down play run" to the resulting
   threshold time per timeout count. We translate to a management category.
   Categories: NONE (no constraint), MODEST, MODERATE, SEVERE, DELAY_KNEE,
   KNEE (take a knee — can run clock out / end game).
   The source's right-hand columns ("End of Game") mean you can kneel it out.
   We reconstruct categories from the document's color bands. */
function lgmCategory(timeSec, oppTO) {
  // oppTO in {0,1,2,3}. Bands derived from the PFF chart structure.
  // Thresholds (in seconds) at which you transition between bands shift later
  // as the opponent has fewer timeouts.
  const m = timeSec; // seconds remaining when 1st-down play is run
  // Boundaries per timeout count: [kneeAtOrBelow, severeBelow, moderateBelow, modestBelow]
  // Above modestBelow => NONE. At/below kneeAtOrBelow => can kneel out.
  const B = {
    0: { knee: 120, severe: 150, moderate: 175, modest: 245 },
    1: { knee: 100, severe: 130, moderate: 210, modest: 300 },
    2: { knee: 60,  severe: 95,  moderate: 175, modest: 300 },
    3: { knee: 25,  severe: 60,  moderate: 130, modest: 300 },
  }[oppTO];
  if (m <= B.knee) {
    // Within ~2 plays of kneeling it out.
    if (m <= B.knee - 30) return "KNEE";
    return "DELAY_KNEE";
  }
  if (m <= B.severe) return "SEVERE";
  if (m <= B.moderate) return "MODERATE";
  if (m <= B.modest) return "MODEST";
  return "NONE";
}

/* Estimate the time the OPPONENT gets the ball back with — i.e. the value the
   PFF chart prints inside each cell. Mirrors the chart's clock mechanic:
   you keep the ball for up to three more snaps (one play already run on 1st
   down). With no opponent timeouts, each kept down drains a full ~40s play
   clock + ~5s snap. Each opponent timeout stops the clock on one of those
   downs, clawing that drain back. We cap drained downs at 3 (the final
   kept-down sequence before you'd punt / hand it over). Returns seconds the
   opponent has left, floored at 0. */
function lgmTimeLeft(timeSec, oppTO) {
  const SNAP = 6;        // ~time to run a play
  const PLAYCLOCK = 40;  // seconds bled per down when clock keeps running
  const downsLeft = 3;   // remaining kept-down sequence before you give it up
  let remaining = timeSec;
  for (let d = 0; d < downsLeft; d++) {
    if (remaining <= 0) break;
    // Run the play itself.
    remaining -= SNAP;
    if (remaining <= 0) break;
    // If opponent still has a timeout for this down, they stop the clock;
    // otherwise the play clock runs.
    if (oppTO > 0) {
      oppTO -= 1; // they spend one stopping the clock
    } else {
      remaining -= PLAYCLOCK;
    }
  }
  return Math.max(0, Math.round(remaining));
}

const LGM_META = {
  NONE:       { text: "NO TIME CONSTRAINT",       cls: "lgm-none",   blurb: "Run your normal offense. No need to rush." },
  MODEST:     { text: "MODEST TIME CONSTRAINT",   cls: "lgm-modest", blurb: "Be mindful of the clock, but you have room." },
  MODERATE:   { text: "MODERATE TIME CONSTRAINT", cls: "lgm-mod",    blurb: "Push tempo. Get plays off efficiently." },
  SEVERE:     { text: "SEVERE TIME CONSTRAINT",   cls: "lgm-sev",    blurb: "Clock won't run out yet — play it out, stay in bounds, milk the play clock." },
  DELAY_KNEE: { text: "CLOCK-BURN MODE",         cls: "lgm-delay",  blurb: "Burn clock safely and avoid unnecessary live snaps." },
  KNEE:       { text: "CLOCK CONTROLLED",         cls: "lgm-knee",   blurb: "Ball security and clean operation matter more than running a real play." },
};


function clockCoachingMessage(cat, oppLeftStr, to) {
  const timeoutContext =
    to === 0
      ? "They have no timeouts, so every in-bounds snap has major clock value."
      : `They can stop the clock ${to} time${to === 1 ? "" : "s"}, so the staff has to account for that lost drain.`;

  const messages = {
    KNEE: {
      outlook:
        "The clock is fully controlled. This is a ball-security/end-of-half operation, not a normal play-calling situation.",
      sidelineUse:
        "Use this to avoid unnecessary live snaps. The value is risk reduction: protect the ball, avoid penalties, and communicate the clock-burn operation cleanly.",
      coachingFocus:
        "Priority: ball security, clean operation, no avoidable clock-stopping mistakes.",
      chainNote: null,
      speak:
        "Clock fully controlled. Shift to ball-security mode and avoid unnecessary live snaps.",
    },
    DELAY_KNEE: {
      outlook:
        "The clock is almost fully controlled. The next operation is about burning clock safely before moving into end-of-half mode.",
      sidelineUse:
        "Use this to prevent a rushed or unnecessary live play. The staff should be thinking about clock mechanics, ball security, and avoiding penalties.",
      coachingFocus:
        "Priority: burn the play clock, protect the ball, and avoid giving away a free stoppage.",
      chainNote: null,
      speak:
        "Clock nearly controlled. Burn clock safely and protect the ball.",
    },
    SEVERE: {
      outlook: `If you run the series out normally, the opponent is projected to get about ${oppLeftStr}. That is a real possession, not garbage time.`,
      sidelineUse:
        "Use this to show that a conservative three-play sequence may still hand them a legitimate drive. The offense needs to treat the next first down as a major win-probability event.",
      coachingFocus:
        "Priority: stay in bounds, snap late, make them spend timeouts, and call plays with a real chance to earn the first down.",
      chainNote:
        "One first down is the swing point: without it, they likely get a real possession; with it, the game/half can shift heavily in your favor.",
      speak:
        `Severe time constraint. They may get about ${oppLeftStr}, so the next first down is the key. Stay in bounds, snap late, and force timeouts.`,
    },
    MODERATE: {
      outlook: `If you do not earn another first down, the opponent is projected to get about ${oppLeftStr}. That is limited, but still usable.`,
      sidelineUse:
        "Use this to balance clock burn with conversion chances. You are not in panic mode, but the offense still needs to avoid clock-stopping plays and understand how valuable one more first down is.",
      coachingFocus:
        "Priority: stay in bounds, use the play clock, and choose calls that keep the chains moving without creating unnecessary risk.",
      chainNote:
        "One first down likely turns this from a manageable opponent possession into a much safer clock-control situation.",
      speak:
        `Moderate time constraint. They may get about ${oppLeftStr}. Stay in bounds, use the play clock, and keep the chains moving.`,
    },
    MODEST: {
      outlook: `If you run the series out normally, the opponent is projected to get about ${oppLeftStr}. That is a short, pressured possession.`,
      sidelineUse:
        "Use this to avoid overreacting. The clock is helping you, so the sideline can prioritize clean execution and ball security instead of forcing aggressive clock-management decisions.",
      coachingFocus:
        "Priority: avoid incomplete passes, out-of-bounds plays, penalties, and turnovers. Make the opponent operate with limited time.",
      chainNote:
        "One first down likely puts the situation close to fully controlled, but the main job is avoiding self-inflicted clock stoppages.",
      speak:
        `Modest time constraint. They may get about ${oppLeftStr}. Prioritize clean execution, ball security, and no free clock stoppages.`,
    },
    NONE: {
      outlook:
        `There is no special clock constraint from this chart. ${timeoutContext}`,
      sidelineUse:
        "Use this as a green light to run the offense normally instead of letting the clock situation distort the call sheet.",
      coachingFocus:
        "Priority: normal offensive operation. Stay aware of clock, but do not let it override the football call.",
      chainNote: null,
      speak:
        "No special clock constraint. Run the offense normally and stay aware of the game situation.",
    },
  };

  return messages[cat] || messages.NONE;
}

/* ============================================================================
   PARSER: turn a spoken/typed sentence into a structured query + answer.
   ========================================================================== */

const wordsToNum = {
  zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,
  seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,
};

function normalizeNumbers(s) {
  // crude: replace standalone number-words with digits
  return s.replace(/\b([a-z]+)\b/g, (m) =>
    wordsToNum[m] !== undefined ? String(wordsToNum[m]) : m
  );
}

function inferMarginFromText(raw) {
  const s = normalizeNumbers(String(raw || "").toLowerCase());
  let m =
    s.match(/(?:up|lead(?:ing)?|ahead)\s*(?:by\s*)?(\d{1,2})/) ||
    s.match(/(\d{1,2})\s*point\s*lead/);
  if (m) return parseInt(m[1]);

  m = s.match(/(?:down|trail(?:ing)?|behind|lose|losing)\s*(?:by\s*)?(\d{1,2})/);
  if (m) return -parseInt(m[1]);

  if (/\b(?:tie|tied|even)\b/.test(s)) return 0;
  return null;
}

function parseClock(s) {
  // matches 8:50, 8 50, "8 minutes 50", "eight fifty"
  let m = s.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = s.match(/(\d{1,2})\s*min[a-z]*\s*(\d{1,2})/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = s.match(/(\d{1,2})\s*min/);
  if (m) return parseInt(m[1]) * 60;
  m = s.match(/(\d{1,2})\s*sec/);
  if (m) return parseInt(m[1]);
  return null;
}

function detectIntent(s) {
  if (/penalt|accept|declin|flag/.test(s)) return "penalty";
  if (/clock|time\s*manage|kneel|knee|run.*clock|manage.*clock|late\s*game|first.?down play|victory/.test(s))
    return "clock";
  if (/(?:go for|going for)\s*(?:2|two|it the two)/.test(s) ||
      /two|2.?point|extra point|\bxp\b|convert/.test(s))
    return "twopoint";
  return "twopoint"; // default to the two-point chart
}

function timeBucketFor(quarter, clockSec) {
  // Map to two-point chart columns.
  if (quarter === 1 || quarter === 2) return "H1";
  if (quarter === 3) return "Q3";
  if (quarter === 4 || quarter === 5) {
    if (clockSec == null) return "Q4_10";
    if (clockSec > 600) return "Q4_15";
    if (clockSec > 300) return "Q4_10";
    if (clockSec > 180) return "Q4_5";
    if (clockSec > 60) return "Q4_3";
    return "Q4_1";
  }
  return "H1";
}

function answerTwoPoint(raw) {
  const s = normalizeNumbers(raw.toLowerCase());
  // lead / deficit
  let diff = null;
  let m =
    s.match(/(?:up|lead(?:ing)?|ahead)\s*(?:by\s*)?(\d{1,2})/) ||
    s.match(/(\d{1,2})\s*point\s*lead/);
  if (m) diff = parseInt(m[1]);
  if (diff == null) {
    m = s.match(/(?:down|trail(?:ing)?|behind|lose|losing)\s*(?:by\s*)?(\d{1,2})/);
    if (m) diff = -parseInt(m[1]);
  }
  if (diff == null) {
    m = s.match(/(?:tie|tied|even)/);
    if (m) diff = 0;
  }
  // quarter
  let quarter = null;
  if (/(?:1st|first)\s*(?:half|quarter|q)/.test(s) || /\bq1\b|\bq2\b|second quarter|half/.test(s)) quarter = 2;
  if (/(?:3rd|third)\s*(?:quarter|q)|\bq3\b/.test(s)) quarter = 3;
  if (/(?:4th|fourth)\s*(?:quarter|q)|\bq4\b|fourth/.test(s)) quarter = 4;
  if (quarter == null) quarter = 4; // most 2pt decisions are late
  const clock = parseClock(s);

  if (diff == null) {
    return {
      kind: "twopoint",
      error:
        "I need the score margin. Say something like “up 8 with 5 minutes left in the 4th.”",
    };
  }
  // This chart's differential is AFTER the touchdown, before the PAT.
  // If a coach says "up 8" they usually mean the post-TD margin already.
  const lookupDiff = Math.max(-26, Math.min(26, diff));
  const col = timeBucketFor(quarter, clock);
  const colIdx = TWO_PT_COLS.findIndex((c) => c.key === col);
  const row = TWO_PT_GRID[lookupDiff] || TWO_PT_GRID[lookupDiff > 0 ? 26 : -26];
  const code = String(row[colIdx]);
  const meta = REC_META[code] || REC_META["1"];
  const colLabel = TWO_PT_COLS[colIdx].label;
  const diffLabel =
    diff > 0 ? `up ${diff}` : diff < 0 ? `down ${Math.abs(diff)}` : "tied";
  return {
    kind: "twopoint",
    diff,
    diffLabel,
    col,
    colLabel,
    code,
    meta,
    speak: `${meta.text}. ${meta.blurb}`,
    detail: `Margin after TD: ${diffLabel} • Time bucket: ${colLabel} • Confidence: ${meta.tier}`,
  };
}

function parseDownDist(s) {
  // "2nd and 7", "second and seven", "2 and 7"
  let m = s.match(/(\d)\s*(?:st|nd|rd|th)?\s*(?:and|&)\s*(\d{1,2})/);
  if (m) return { down: parseInt(m[1]), dist: parseInt(m[2]) };
  return null;
}

function answerPenalty(raw) {
  const s = normalizeNumbers(raw.toLowerCase());
  const side = /defen|\bd\b|we.?re on defense|their (?:ball|offense)/.test(s)
    ? "defense"
    : "offense";
  // The penalty would give: original down/dist; the play result is what you keep on decline.
  // Coach states: penalty result (down & dist) AND actual play result (down & dist).
  // We try to find two down/dist pairs.
  const pairs = [];
  const re = /(\d)\s*(?:st|nd|rd|th)?\s*(?:and|&)\s*(\d{1,2})/g;
  let mm;
  while ((mm = re.exec(s)) !== null)
    pairs.push({ down: parseInt(mm[1]), dist: parseInt(mm[2]) });

  if (pairs.length < 2) {
    return {
      kind: "penalty",
      error:
        "Tell me the penalty result and the play result — e.g. “on offense, penalty gives 1st and 10, the play got us to 2nd and 3.”",
    };
  }
  const penPair = pairs[0];
  const playPair = pairs[1];
  const penKey = `${penPair.down} and ${penPair.dist}`;
  const table = side === "defense" ? PENALTY_DEFENSE : PENALTY_OFFENSE;
  const entry = table.find((e) => e.pen === penKey);

  let decision, reason;
  if (!entry) {
    decision = "ACCEPT";
    reason = `No decline guidance for ${penKey} on ${side} — accept the penalty.`;
  } else if (entry.declineAt == null) {
    decision = "ACCEPT";
    reason = `On ${side}, never decline with a ${penKey} penalty result.`;
  } else {
    const thr = entry.declineAt;
    // The threshold is from YOUR perspective.
    // On offense, lower down / shorter distance is better for you.
    // On defense, higher down / longer distance is better for you.
    const reachedDeclineThreshold = side === "defense"
      ? (playPair.down > thr.down ||
          (playPair.down === thr.down && playPair.dist >= thr.dist))
      : (playPair.down < thr.down ||
          (playPair.down === thr.down && playPair.dist <= thr.dist));

    if (reachedDeclineThreshold) {
      decision = "DECLINE";
      reason = side === "defense"
        ? `On defense, the play result (${playPair.down} and ${playPair.dist}) is at/worse for the offense than the decline threshold (${thr.down} and ${thr.dist}). Keep the play.`
        : `On offense, the play result (${playPair.down} and ${playPair.dist}) is at/better for you than the decline threshold (${thr.down} and ${thr.dist}). Keep the play.`;
    } else {
      decision = "ACCEPT";
      reason = side === "defense"
        ? `On defense, the play result (${playPair.down} and ${playPair.dist}) is better for the offense than the decline threshold (${thr.down} and ${thr.dist}). Take the penalty.`
        : `On offense, the play result (${playPair.down} and ${playPair.dist}) is worse for you than the decline threshold (${thr.down} and ${thr.dist}). Take the penalty.`;
    }
  }
  return {
    kind: "penalty",
    side,
    decision,
    reason,
    speak: `${decision} the penalty. ${reason}`,
    detail: `${side.toUpperCase()} • penalty result ${penKey} • play result ${playPair.down} and ${playPair.dist}`,
  };
}

function answerClock(raw) {
  const s = normalizeNumbers(raw.toLowerCase());
  const clock = parseClock(s);
  let to = null;
  let m =
    s.match(/(\d)\s*(?:opp[a-z]*\s*)?time\s*out/) ||
    s.match(/opp[a-z]*\s*(?:has\s*)?(\d)\s*time\s*out/) ||
    s.match(/(\d)\s*to\b/);
  if (m) to = parseInt(m[1]);
  if (to == null) {
    if (/no time\s*out|zero time\s*out|out of time\s*out/.test(s)) to = 0;
  }
  if (clock == null) {
    return {
      kind: "clock",
      error:
        "I need the clock and opponent timeouts — e.g. “2:40 left, they have 1 timeout.”",
    };
  }

  // This tool focuses only on clock mechanics: snap time + opponent timeouts.
  if (to == null) to = 3; // worst case assumption
  to = Math.max(0, Math.min(3, to));
  const cat = lgmCategory(clock, to);
  const meta = LGM_META[cat];
  const oppLeft = lgmTimeLeft(clock, to);
  const canEndIt = cat === "KNEE" || cat === "DELAY_KNEE";

  const warn = null;

  const oppLeftStr = oppLeft <= 0 ? "no time" : fmt(oppLeft);
  const clockMsg = clockCoachingMessage(cat, oppLeftStr, to);
  const outlook = clockMsg.outlook;
  const sidelineUse = clockMsg.sidelineUse;
  const coachingFocus = clockMsg.coachingFocus;
  const chainNote = clockMsg.chainNote;

  const baseDetail = `1st-down snap at ${fmt(clock)} • opponent ${to} timeout${to === 1 ? "" : "s"}`;
  const detail = `${baseDetail} • clock-control situation`;

  const spokenCore = `${meta.text}. ${clockMsg.speak}`;

  return {
    kind: "clock",
    clock,
    to,
    lead: null,
    cat,
    meta,
    warn,
    oppLeft,
    oppLeftStr,
    outlook,
    sidelineUse,
    coachingFocus,
    chainNote,
    canEndIt,
    speak: warn ? `${warn} ${spokenCore}` : spokenCore,
    detail,
  };
}

function answer(raw, forcedIntent = null) {
  const intent = forcedIntent || detectIntent(raw.toLowerCase());
  if (intent === "penalty") return answerPenalty(raw);
  if (intent === "clock") return answerClock(raw);
  return answerTwoPoint(raw);
}

/* ============================================================================
   AI STRUCTURED EXTRACTION ADAPTER
   ----------------------------------------------------------------------------
   The AI parser only translates messy speech/text into clean fields. It does
   NOT make the football decision. These functions keep the actual call chart-
   based and deterministic.
   ========================================================================== */

function answerTwoPointStructured(data = {}, sourceLabel = "AI parsed", rawText = "") {
  let diff = data.score_margin_after_td;
  if (diff === null || diff === undefined || Number.isNaN(Number(diff))) {
    diff = inferMarginFromText(rawText);
  }
  if (diff === null || diff === undefined || Number.isNaN(Number(diff))) {
    return {
      kind: "twopoint",
      error:
        "I need the score margin — e.g. “up 8, 5:00 left in the 4th.” I’ll assume the margin is after the TD unless you say otherwise.",
    };
  }

  const quarter = data.quarter ?? 4;
  const clock = data.clock_seconds ?? null;
  const lookupDiff = Math.max(-26, Math.min(26, Number(diff)));
  const col = timeBucketFor(Number(quarter), clock);
  const colIdx = TWO_PT_COLS.findIndex((c) => c.key === col);
  const row = TWO_PT_GRID[lookupDiff] || TWO_PT_GRID[lookupDiff > 0 ? 26 : -26];
  const code = String(row[colIdx]);
  const meta = REC_META[code] || REC_META["1"];
  const colLabel = TWO_PT_COLS[colIdx].label;
  const diffLabel =
    diff > 0 ? `up ${diff}` : diff < 0 ? `down ${Math.abs(diff)}` : "tied";

  return {
    kind: "twopoint",
    diff,
    diffLabel,
    col,
    colLabel,
    code,
    meta,
    speak: `${meta.text}. ${meta.blurb}`,
    detail: `${sourceLabel}: margin after TD ${diffLabel} • Time bucket: ${colLabel} • Confidence: ${meta.tier}`,
  };
}

function answerPenaltyStructured(data = {}, sourceLabel = "AI parsed") {
  const side = data.side === "defense" ? "defense" : "offense";
  const penDown = data.penalty_down;
  const penDist = data.penalty_distance;
  const playDown = data.play_result_down;
  const playDist = data.play_result_distance;

  if ([penDown, penDist, playDown, playDist].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return {
      kind: "penalty",
      error:
        "I need the penalty result and the play result — e.g. “on defense, penalty gives 2nd and 15, play result is 3rd and 8.”",
    };
  }

  const penKey = `${Number(penDown)} and ${Number(penDist)}`;
  const playPair = { down: Number(playDown), dist: Number(playDist) };
  const table = side === "defense" ? PENALTY_DEFENSE : PENALTY_OFFENSE;
  const entry = table.find((e) => e.pen === penKey);

  let decision, reason;
  if (!entry) {
    decision = "ACCEPT";
    reason = `No decline guidance for ${penKey} on ${side} — accept the penalty.`;
  } else if (entry.declineAt == null) {
    decision = "ACCEPT";
    reason = `On ${side}, never decline with a ${penKey} penalty result.`;
  } else {
    const thr = entry.declineAt;
    // The threshold is from YOUR perspective.
    // On offense, lower down / shorter distance is better for you.
    // On defense, higher down / longer distance is better for you.
    const reachedDeclineThreshold = side === "defense"
      ? (playPair.down > thr.down ||
          (playPair.down === thr.down && playPair.dist >= thr.dist))
      : (playPair.down < thr.down ||
          (playPair.down === thr.down && playPair.dist <= thr.dist));

    if (reachedDeclineThreshold) {
      decision = "DECLINE";
      reason = side === "defense"
        ? `On defense, the play result (${playPair.down} and ${playPair.dist}) is at/worse for the offense than the decline threshold (${thr.down} and ${thr.dist}). Keep the play.`
        : `On offense, the play result (${playPair.down} and ${playPair.dist}) is at/better for you than the decline threshold (${thr.down} and ${thr.dist}). Keep the play.`;
    } else {
      decision = "ACCEPT";
      reason = side === "defense"
        ? `On defense, the play result (${playPair.down} and ${playPair.dist}) is better for the offense than the decline threshold (${thr.down} and ${thr.dist}). Take the penalty.`
        : `On offense, the play result (${playPair.down} and ${playPair.dist}) is worse for you than the decline threshold (${thr.down} and ${thr.dist}). Take the penalty.`;
    }
  }

  return {
    kind: "penalty",
    side,
    decision,
    reason,
    speak: `${decision} the penalty. ${reason}`,
    detail: `${sourceLabel}: ${side.toUpperCase()} • penalty result ${penKey} • play result ${playPair.down} and ${playPair.dist}`,
  };
}

function answerClockStructured(data = {}, sourceLabel = "AI parsed") {
  const clock = data.clock_seconds;
  let to = data.opponent_timeouts;
  if (clock === null || clock === undefined || Number.isNaN(Number(clock))) {
    return {
      kind: "clock",
      error:
        "I need the clock — e.g. “2:40 left, opponent has 1 timeout.”",
    };
  }
  if (to === null || to === undefined || Number.isNaN(Number(to))) to = 3;

  to = Math.max(0, Math.min(3, Number(to)));
  const cat = lgmCategory(Number(clock), to);
  const meta = LGM_META[cat];
  const oppLeft = lgmTimeLeft(Number(clock), to);
  const canEndIt = cat === "KNEE" || cat === "DELAY_KNEE";

  const warn = null;

  const oppLeftStr = oppLeft <= 0 ? "no time" : fmt(oppLeft);
  const clockMsg = clockCoachingMessage(cat, oppLeftStr, to);
  const outlook = clockMsg.outlook;
  const sidelineUse = clockMsg.sidelineUse;
  const coachingFocus = clockMsg.coachingFocus;
  const chainNote = clockMsg.chainNote;

  const baseDetail = `${sourceLabel}: 1st-down snap at ${fmt(Number(clock))} • opponent ${to} timeout${to === 1 ? "" : "s"}`;
  const detail = `${baseDetail} • clock-control situation`;

  const spokenCore = `${meta.text}. ${clockMsg.speak}`;

  return {
    kind: "clock",
    clock: Number(clock),
    to,
    lead: null,
    cat,
    meta,
    warn,
    oppLeft,
    oppLeftStr,
    outlook,
    sidelineUse,
    coachingFocus,
    chainNote,
    canEndIt,
    speak: warn ? `${warn} ${spokenCore}` : spokenCore,
    detail,
  };
}

function answerFromStructured(parsed, fallbackMode = "twopoint", rawText = "") {
  const mode = parsed?.mode || fallbackMode;
  if (mode === "penalty") return answerPenaltyStructured(parsed?.penalty);
  if (mode === "clock") return answerClockStructured(parsed?.clock);
  return answerTwoPointStructured(parsed?.twopoint, "AI parsed", rawText);
}

async function parseSituationWithAI(mode, transcript) {
  const res = await fetch("/api/parse-situation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, transcript }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "AI parser failed.");
  }
  return res.json();
}

async function parseAudioWithAI(mode, audioBlob) {
  const fd = new FormData();
  fd.append("mode", mode);
  fd.append("audio", audioBlob, "sideline-call.webm");

  const res = await fetch("/api/transcribe-situation", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "AI audio parser failed.");
  }
  return res.json();
}

/* Short read-back of the PARSED situation, so a coach can catch a mis-hear
   before the call commits. Describes what the tool understood, not the answer. */
function summarize(res) {
  if (!res || res.error) return null;
  if (res.kind === "twopoint") {
    const t = res.colLabel.replace("Q4 ", "4th, ").replace("1st Half", "1st half");
    return `${res.diffLabel} after the touchdown, ${t}`;
  }
  if (res.kind === "penalty") {
    const pen = res.detail.match(/penalty result ([\d]+ and [\d]+)/);
    const play = res.detail.match(/play result ([\d]+ and [\d]+)/);
    return `${res.side}, penalty makes it ${pen ? pen[1] : "?"}, play got ${play ? play[1] : "?"}`;
  }
  if (res.kind === "clock") {
    return `snap at ${fmt(res.clock)}, opponent ${res.to} timeout${res.to === 1 ? "" : "s"}`;
  }
  return null;
}

/* ============================================================================
   TAPPABLE CHART GRIDS
   Offline-safe lookup that mirrors the paper charts. A position coach runs a
   finger to the cell; tapping it reads the call aloud and shows the detail.
   ========================================================================== */

// Map a two-point code -> swatch color (matches REC_META cls).
const TWO_PT_SWATCH = {
  "2":   "#2f9e44", "L2": "#69c34a", "T": "#f4c542",
  "WK1": "#f08c2e", "L1": "#f08c2e", "1": "#b3261e",
};
// Map a clock category -> swatch color (matches LGM_META cls).
const LGM_SWATCH = {
  NONE: "#2f9e44", MODEST: "#a7c34a", MODERATE: "#f08c2e",
  SEVERE: "#b3261e", DELAY_KNEE: "#3b6fd4", KNEE: "#7a3bd4",
};

// Clock grid: which snap-time rows to show (coarser than every 5s for taps).
const CLOCK_GRID_ROWS = [];
for (let t = 300; t >= 30; t -= 15) CLOCK_GRID_ROWS.push(t);

function ClockGrid({ onPick }) {
  return (
    <div className="sa-grid-wrap">
      <div className="sa-grid sa-grid-clock">
        <div className="sa-gh sa-gh-corner">SNAP</div>
        {[0, 1, 2, 3].map((to) => (
          <div key={to} className="sa-gh">{to} TO</div>
        ))}
        {CLOCK_GRID_ROWS.map((t) => (
          <React.Fragment key={t}>
            <div className="sa-grow-label">{fmt(t)}</div>
            {[0, 1, 2, 3].map((to) => {
              const cat = lgmCategory(t, to);
              const left = lgmTimeLeft(t, to);
              const ending = cat === "KNEE";
              return (
                <button
                  key={to}
                  className="sa-cell"
                  style={{ background: LGM_SWATCH[cat] }}
                  onClick={() => onPick(t, to)}
                  title={`${fmt(t)}, ${to} TO`}
                >
                  {ending ? "KNEE" : fmt(left)}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="sa-glegend">
        <span><i style={{ background: "#2f9e44" }} />None</span>
        <span><i style={{ background: "#a7c34a" }} />Modest</span>
        <span><i style={{ background: "#f08c2e" }} />Mod</span>
        <span><i style={{ background: "#b3261e" }} />Severe</span>
        <span><i style={{ background: "#3b6fd4" }} />Delay</span>
        <span><i style={{ background: "#7a3bd4" }} />Knee</span>
      </div>
      <p className="sa-grid-note">
        Cell = time the opponent gets the ball back. Assumes you're protecting a
        lead. Tap any cell to hear the call.
      </p>
    </div>
  );
}

function TwoPtGrid({ onPick }) {
  return (
    <div className="sa-grid-wrap">
      <div className="sa-grid sa-grid-2pt">
        <div className="sa-gh sa-gh-corner">DIFF</div>
        {TWO_PT_COLS.map((c) => (
          <div key={c.key} className="sa-gh sa-gh-sm">{c.label.replace("Q4 ", "")}</div>
        ))}
        {TWO_PT_DIFFS.map((d) => (
          <React.Fragment key={d}>
            <div className="sa-grow-label">{d > 0 ? `+${d}` : d}</div>
            {TWO_PT_COLS.map((c, ci) => {
              const code = String(TWO_PT_GRID[d][ci]);
              return (
                <button
                  key={c.key}
                  className="sa-cell sa-cell-sm"
                  style={{ background: TWO_PT_SWATCH[code] }}
                  onClick={() => onPick(d, c.key)}
                  title={`${d > 0 ? "+" + d : d}, ${c.label}`}
                />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="sa-glegend">
        <span><i style={{ background: "#2f9e44" }} />Go 2</span>
        <span><i style={{ background: "#69c34a" }} />Lean 2</span>
        <span><i style={{ background: "#f4c542" }} />Toss</span>
        <span><i style={{ background: "#f08c2e" }} />Lean kick</span>
        <span><i style={{ background: "#b3261e" }} />Kick</span>
      </div>
      <p className="sa-grid-note">
        Row = your lead after the TD, before the PAT. Tap a cell for the call.
      </p>
    </div>
  );
}



/* ============================================================================
   COMPONENT
   ========================================================================== */

const INTENTS = [
  { key: "twopoint", label: "Two-Point", icon: Target,
    ex: "Ex: Up 6 after the TD, 5:32 left in the 4th quarter." },
  { key: "penalty", label: "Penalty", icon: Flag,
    ex: "Ex: On offense, penalty gives 1st and 10, play result is 2nd and 3." },
  { key: "clock", label: "Clock", icon: Clock,
    ex: "Ex: 2:40 left in the half, opponent has 1 timeout." },
];

const DISTANCE_OPTIONS = Array.from({ length: 25 }, (_, i) => i + 1);
const DOWN_OPTIONS = [1, 2, 3, 4];
const CLOCK_OPTIONS = LGM_TIMES;

function answerTwoPointManual(diff, colKey) {
  const colIdx = TWO_PT_COLS.findIndex((c) => c.key === colKey);
  const safeColIdx = colIdx >= 0 ? colIdx : 0;
  const lookupDiff = Math.max(-26, Math.min(26, Number(diff)));
  const code = String(TWO_PT_GRID[lookupDiff][safeColIdx]);
  const meta = REC_META[code] || REC_META["1"];
  const diffLabel = lookupDiff > 0 ? `up ${lookupDiff}` : lookupDiff < 0 ? `down ${Math.abs(lookupDiff)}` : "tied";
  const colLabel = TWO_PT_COLS[safeColIdx].label;

  return {
    kind: "twopoint",
    diff: lookupDiff,
    diffLabel,
    col: TWO_PT_COLS[safeColIdx].key,
    colLabel,
    code,
    meta,
    speak: `${meta.text}. ${meta.blurb}`,
    detail: `Manual: margin after TD ${diffLabel} • Time bucket: ${colLabel} • Confidence: ${meta.tier}`,
  };
}

function ManualPanel({
  mode,
  setGrid,
  manualTwoDiff,
  setManualTwoDiff,
  manualTwoCol,
  setManualTwoCol,
  manualPenaltySide,
  setManualPenaltySide,
  manualPenaltyDown,
  setManualPenaltyDown,
  manualPenaltyDist,
  setManualPenaltyDist,
  manualPlayDown,
  setManualPlayDown,
  manualPlayDist,
  setManualPlayDist,
  manualClockSec,
  setManualClockSec,
  manualClockTO,
  setManualClockTO,
  runManualTwoPoint,
  runManualPenalty,
  runManualClock,
}) {
  if (mode === "twopoint") {
    return (
      <div className="sa-manual-panel">
        <div className="sa-manual-head">
          <div>
            <strong>Manual two-point lookup</strong>
            <span>Works offline. Use dropdowns or open the tappable chart.</span>
          </div>
          <button className="sa-mini-btn" onClick={() => setGrid("twopoint")} type="button">
            <Grid3x3 size={14} /> Chart
          </button>
        </div>
        <div className="sa-manual-grid two">
          <label>
            Margin after TD
            <select value={manualTwoDiff} onChange={(e) => setManualTwoDiff(Number(e.target.value))}>
              {TWO_PT_DIFFS.map((d) => (
                <option key={d} value={d}>{d > 0 ? `Up ${d}` : d < 0 ? `Down ${Math.abs(d)}` : "Tied"}</option>
              ))}
            </select>
          </label>
          <label>
            Time bucket
            <select value={manualTwoCol} onChange={(e) => setManualTwoCol(e.target.value)}>
              {TWO_PT_COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <button className="sa-manual-submit" onClick={runManualTwoPoint} type="button">Get two-point call</button>
      </div>
    );
  }

  if (mode === "penalty") {
    return (
      <div className="sa-manual-panel">
        <div className="sa-manual-head">
          <div>
            <strong>Manual penalty lookup</strong>
            <span>Works offline. First enter the result if you ACCEPT the penalty, then enter the actual play result you would keep if you DECLINE it.</span>
          </div>
        </div>

        <div className="sa-manual-inline-top">
          <label>
            Side
            <select value={manualPenaltySide} onChange={(e) => setManualPenaltySide(e.target.value)}>
              <option value="offense">Offense</option>
              <option value="defense">Defense</option>
            </select>
          </label>
        </div>

        <div className="sa-manual-sections penalty">
          <div className="sa-manual-box">
            <div className="sa-manual-box-title">Penalty accepted result</div>
            <div className="sa-manual-box-sub">This is the down and distance if you TAKE the penalty.</div>
            <div className="sa-manual-grid penalty-box">
              <label>
                Down if accepted
                <select value={manualPenaltyDown} onChange={(e) => setManualPenaltyDown(Number(e.target.value))}>
                  {[1, 2].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>
                Distance if accepted
                <select value={manualPenaltyDist} onChange={(e) => setManualPenaltyDist(Number(e.target.value))}>
                  {DISTANCE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="sa-manual-box">
            <div className="sa-manual-box-title">Actual play result</div>
            <div className="sa-manual-box-sub">This is the down and distance from the play itself if you KEEP the play.</div>
            <div className="sa-manual-grid penalty-box">
              <label>
                Play down
                <select value={manualPlayDown} onChange={(e) => setManualPlayDown(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>
                Play distance
                <select value={manualPlayDist} onChange={(e) => setManualPlayDist(Number(e.target.value))}>
                  {DISTANCE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>
        <button className="sa-manual-submit" onClick={runManualPenalty} type="button">Get penalty call</button>
      </div>
    );
  }

  return (
    <div className="sa-manual-panel">
      <div className="sa-manual-head">
        <div>
          <strong>Manual clock lookup</strong>
          <span>Works offline. Use this late in a half/game to estimate the opponent’s remaining possession time and decide how urgent the next first down is.</span>
        </div>
        <button className="sa-mini-btn" onClick={() => setGrid("clock")} type="button">
          <Grid3x3 size={14} /> Chart
        </button>
      </div>
      <div className="sa-clock-help">
        <strong>Use this to answer:</strong> How much time do they get back? Is a normal run sequence safe? How valuable is one more first down?
      </div>
      <div className="sa-manual-grid clock">
        <label>
          Clock at 1st-down snap
          <select value={manualClockSec} onChange={(e) => setManualClockSec(Number(e.target.value))}>
            {CLOCK_OPTIONS.map((t) => <option key={t} value={t}>{fmt(t)}</option>)}
          </select>
        </label>
        <label>
          Opponent timeouts
          <select value={manualClockTO} onChange={(e) => setManualClockTO(Number(e.target.value))}>
            {[0, 1, 2, 3].map((to) => <option key={to} value={to}>{to}</option>)}
          </select>
        </label>
      </div>
      <button className="sa-manual-submit" onClick={runManualClock} type="button">Get clock call</button>
    </div>
  );
}

export default function SidelineAssistant() {
  const [listening, setListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState(null);
  const [supported, setSupported] = useState(true);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState("twopoint");
  const [inputMode, setInputMode] = useState("ai"); // "ai" | "manual"
  const [manualTwoDiff, setManualTwoDiff] = useState(6);
  const [manualTwoCol, setManualTwoCol] = useState("Q4_5");
  const [manualPenaltySide, setManualPenaltySide] = useState("offense");
  const [manualPenaltyDown, setManualPenaltyDown] = useState(1);
  const [manualPenaltyDist, setManualPenaltyDist] = useState(10);
  const [manualPlayDown, setManualPlayDown] = useState(2);
  const [manualPlayDist, setManualPlayDist] = useState(3);
  const [manualClockSec, setManualClockSec] = useState(160);
  const [manualClockTO, setManualClockTO] = useState(1);
  const [muted, setMuted] = useState(false);
  const [grid, setGrid] = useState(null); // null | "clock" | "twopoint"
  const [log, setLog] = useState(() => store.load() || []);
  const [showLog, setShowLog] = useState(false);
  const modeRef = useRef(mode);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSupported(false);
    }
  }, []);

  const speak = useCallback((text) => {
    if (muted) return;
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04; u.pitch = 1.0; u.volume = 1.0;
    window.speechSynthesis.speak(u);
  }, [muted]);

  // Persist the log whenever it changes (no-op in sandbox; durable in prod).
  useEffect(() => { store.save(log); }, [log]);

  // Commit a result: speak the answer, show the card, write to the log.
  const commit = useCallback((res, said) => {
    setResult(res);
    if (!res.error) {
      speak(res.speak);
      setLog((prev) => [
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          kind: res.kind,
          call: res.kind === "penalty"
            ? (res.decision === "DECLINE" ? "DECLINE" : "ACCEPT")
            : res.meta.text,
          cls: res.kind === "penalty"
            ? (res.decision === "DECLINE" ? "go2" : "go1")
            : res.meta.cls,
          situation: said || summarize(res) || res.detail,
        },
        ...prev,
      ].slice(0, 50));
    } else {
      speak(res.error);
    }
  }, [speak]);

  // Send typed text to the AI extractor, then use deterministic chart logic.
  const proposeFromText = useCallback(async (txt) => {
    const activeMode = modeRef.current;
    setParsing(true);
    try {
      const data = await parseSituationWithAI(activeMode, txt);
      const parsed = data.parsed;
      const cleanTranscript = parsed?.corrected_transcript || txt;
      setTranscript(cleanTranscript);
      commit(answerFromStructured(parsed, activeMode, cleanTranscript || txt), cleanTranscript);
    } catch (err) {
      // Keep the app usable offline / during API failures by falling back to the
      // old deterministic regex parser. The UI detail will not say AI parsed.
      console.error(err);
      commit(answer(txt, activeMode), txt);
    } finally {
      setParsing(false);
    }
  }, [commit]);

  const processAudio = useCallback(async (audioBlob) => {
    const activeMode = modeRef.current;
    setParsing(true);
    setTranscript("Processing audio with AI…");
    try {
      const data = await parseAudioWithAI(activeMode, audioBlob);
      const parsed = data.parsed;
      const cleanTranscript = data.transcript || parsed?.corrected_transcript || "";
      setTranscript(cleanTranscript);
      commit(answerFromStructured(parsed, activeMode, cleanTranscript || data.transcript || ""), cleanTranscript);
    } catch (err) {
      console.error(err);
      setTranscript("AI voice parsing failed. Try typing the situation or check the server/API key.");
      commit({
        kind: activeMode,
        error: "AI voice parsing failed. Check your server is running and your OpenAI API key is set.",
      }, "AI voice parsing failed");
    } finally {
      setParsing(false);
    }
  }, [commit]);

  const toggle = async () => {
    if (parsing) return;

    if (listening) {
      try { mediaRecorderRef.current?.stop(); } catch {}
      setListening(false);
      return;
    }

    try {
      setTranscript("");
      setResult(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        mediaStreamRef.current?.getTracks()?.forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setListening(false);

        if (blob.size > 0) {
          processAudio(blob);
        }
      };

      recorder.start();
      setListening(true);
    } catch (err) {
      console.error(err);
      setSupported(false);
      setTranscript("Microphone permission denied or not available. Type the situation below.");
    }
  };

  const runTyped = () => {
    if (!typed.trim() || parsing) return;
    setTranscript(typed);
    proposeFromText(typed);
  };

  // Grid taps are unambiguous — commit directly, no read-back needed.
  const pickClock = (t, to) => {
    const phrase = `${fmt(t)} left, opponent has ${to} timeouts`;
    const res = answerClock(phrase);
    setTranscript(`Chart: snap ${fmt(t)}, ${to} opp TO`);
    setGrid(null);
    commit(res, `snap ${fmt(t)}, opponent ${to} timeout${to === 1 ? "" : "s"}`);
  };
  const pickTwoPt = (d, colKey) => {
    const res = answerTwoPointManual(d, colKey);
    setTranscript(`Chart: ${res.diffLabel}, ${res.colLabel}`);
    setGrid(null);
    commit(res, `${res.diffLabel}, ${res.colLabel}`);
  };

  const runManualTwoPoint = () => {
    const res = answerTwoPointManual(manualTwoDiff, manualTwoCol);
    setTranscript(`Manual: ${res.diffLabel}, ${res.colLabel}`);
    commit(res, summarize(res) || res.detail);
  };

  const runManualPenalty = () => {
    const res = answerPenaltyStructured({
      side: manualPenaltySide,
      penalty_down: manualPenaltyDown,
      penalty_distance: manualPenaltyDist,
      play_result_down: manualPlayDown,
      play_result_distance: manualPlayDist,
    }, "Manual");
    setTranscript(`Manual: ${manualPenaltySide}, penalty ${manualPenaltyDown} and ${manualPenaltyDist}, play ${manualPlayDown} and ${manualPlayDist}`);
    commit(res, summarize(res) || res.detail);
  };

  const runManualClock = () => {
    const res = answerClockStructured({
      score_margin: null,
      clock_seconds: manualClockSec,
      opponent_timeouts: manualClockTO,
    }, "Manual");
    setTranscript(`Manual: ${fmt(Number(manualClockSec))}, opponent ${manualClockTO} timeout${manualClockTO === 1 ? "" : "s"}`);
    commit(res, summarize(res) || res.detail);
  };

  return (
    <div className="sa-root">
      <style>{CSS}</style>

      {grid && (
        <div className="sa-modal" onClick={() => setGrid(null)}>
          <div className="sa-modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="sa-modal-head">
              <div className="sa-modal-tabs">
                <button
                  className={grid === "twopoint" ? "on" : ""}
                  onClick={() => setGrid("twopoint")}
                >
                  <Target size={14} /> Two-Point
                </button>
                <button
                  className={grid === "clock" ? "on" : ""}
                  onClick={() => setGrid("clock")}
                >
                  <Clock size={14} /> Clock
                </button>
              </div>
              <button className="sa-modal-x" onClick={() => setGrid(null)} aria-label="Close charts">
                <X size={18} />
              </button>
            </div>
            {grid === "clock" ? (
              <ClockGrid onPick={pickClock} />
            ) : (
              <TwoPtGrid onPick={pickTwoPt} />
            )}
          </div>
        </div>
      )}

      {showLog && (
        <div className="sa-modal" onClick={() => setShowLog(false)}>
          <div className="sa-modal-inner" onClick={(e) => e.stopPropagation()}>
            <div className="sa-modal-head">
              <div className="sa-modal-tabs">
                <span className="sa-log-title">
                  <History size={15} /> Call log
                </span>
              </div>
              <div className="sa-log-head-btns">
                {log.length > 0 && (
                  <button
                    className="sa-log-clear"
                    onClick={() => setLog([])}
                    aria-label="Clear call log"
                  >
                    <Trash2 size={14} /> Clear
                  </button>
                )}
                <button className="sa-modal-x" onClick={() => setShowLog(false)} aria-label="Close log">
                  <X size={18} />
                </button>
              </div>
            </div>
            {!USE_LOCAL_STORAGE && (
              <div className="sa-log-warn">
                <AlertCircle size={13} /> Session-only here. Turns durable when deployed.
              </div>
            )}
            {log.length === 0 ? (
              <p className="sa-log-empty">No calls yet. Every decision you make gets logged here.</p>
            ) : (
              <div className="sa-log-list">
                {log.map((e) => (
                  <div key={e.id} className="sa-log-row">
                    <span className={`sa-log-pill ${e.cls}`}>{e.call}</span>
                    <div className="sa-log-body">
                      <span className="sa-log-sit">{e.situation}</span>
                      <span className="sa-log-time">{e.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <header className="sa-head">
        <div className="sa-brand">
          <span className="sa-tick" />
          <div>
            <h1>SIDELINE</h1>
            <p>PFF decision charts, on call</p>
          </div>
        </div>
        <div className="sa-head-ctrls">
          <button
            className="sa-mute"
            onClick={() => setGrid("twopoint")}
            aria-label="Open lookup charts"
          >
            <Grid3x3 size={16} /> Charts
          </button>
          <button
            className="sa-mute"
            onClick={() => setShowLog(true)}
            aria-label="Open call history"
          >
            <History size={16} /> Log{log.length ? ` (${log.length})` : ""}
          </button>
          <button
            className={`sa-mute ${muted ? "on" : ""}`}
            onClick={() => setMuted((v) => !v)}
            aria-label={muted ? "Unmute spoken answers" : "Mute spoken answers"}
          >
            <Volume2 size={16} /> {muted ? "Muted" : "Voice on"}
          </button>
        </div>
      </header>

      <div className="sa-mode-wrap">
        <div className="sa-mode-label">What are we deciding?</div>
        <div className="sa-mode-tabs">
          {INTENTS.map((i) => (
            <button
              key={i.key}
              className={mode === i.key ? "on" : ""}
              onClick={() => setMode(i.key)}
              type="button"
            >
              <i.icon size={15} /> {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sa-input-switch">
        <button
          type="button"
          className={inputMode === "ai" ? "on" : ""}
          onClick={() => setInputMode("ai")}
        >
          AI speech/text
        </button>
        <button
          type="button"
          className={inputMode === "manual" ? "on" : ""}
          onClick={() => setInputMode("manual")}
        >
          Manual Input
        </button>
      </div>

      {inputMode === "manual" ? (
        <ManualPanel
          mode={mode}
          setGrid={setGrid}
          manualTwoDiff={manualTwoDiff}
          setManualTwoDiff={setManualTwoDiff}
          manualTwoCol={manualTwoCol}
          setManualTwoCol={setManualTwoCol}
          manualPenaltySide={manualPenaltySide}
          setManualPenaltySide={setManualPenaltySide}
          manualPenaltyDown={manualPenaltyDown}
          setManualPenaltyDown={setManualPenaltyDown}
          manualPenaltyDist={manualPenaltyDist}
          setManualPenaltyDist={setManualPenaltyDist}
          manualPlayDown={manualPlayDown}
          setManualPlayDown={setManualPlayDown}
          manualPlayDist={manualPlayDist}
          setManualPlayDist={setManualPlayDist}
          manualClockSec={manualClockSec}
          setManualClockSec={setManualClockSec}
          manualClockTO={manualClockTO}
          setManualClockTO={setManualClockTO}
          runManualTwoPoint={runManualTwoPoint}
          runManualPenalty={runManualPenalty}
          runManualClock={runManualClock}
        />
      ) : (
        <>
          {/* The call button is the hero — the one thing a coach touches mid-drive */}
          <div className="sa-mic-wrap">
            <button
              className={`sa-mic ${listening ? "live" : ""}`}
              onClick={toggle}
              disabled={!supported || parsing}
              aria-label={listening ? "Stop listening" : "Hold to ask"}
            >
              {listening ? <MicOff size={40} /> : <Mic size={40} />}
              <span className="sa-mic-ring" />
              <span className="sa-mic-ring r2" />
            </button>
            <p className="sa-mic-label">
              {parsing
                ? "AI is parsing the situation…"
                : !supported
                ? "Mic not available here — type below"
                : listening
                ? "Recording… tap again to submit"
                : `Tap and say the ${mode === "twopoint" ? "two-point" : mode} situation`}
            </p>
          </div>

          <div className="sa-type">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runTyped()}
              placeholder={`Type a ${mode === "twopoint" ? "two-point" : mode} situation or use an example below…`}
            />
            <button onClick={runTyped}>Ask</button>
          </div>

          <div className="sa-examples-head">Example prompts</div>
          <div className="sa-examples">
            {INTENTS.map((i) => (
              <button
                key={i.key}
                className={`sa-ex ${mode === i.key ? "on" : ""}`}
                onClick={() => { setMode(i.key); setTyped(i.ex); }}
              >
                <i.icon size={15} />
                <div>
                  <strong>{i.label}</strong>
                  <span>{i.ex}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {transcript && (
        <div className="sa-transcript">
          <ListChecks size={14} /> <span>{transcript}</span>
        </div>
      )}

      {result && <ResultCard result={result} />}

      <footer className="sa-foot">
        Recommendations digitized from PFF Ultimate charts. Use coach judgment for
        matchup, weather, and personnel.
      </footer>
    </div>
  );
}

function ResultCard({ result }) {
  if (result.error) {
    return (
      <div className="sa-card err">
        <div className="sa-card-tag">NEED MORE INFO</div>
        <p className="sa-card-rec">Say it again</p>
        <p className="sa-card-detail">{result.error}</p>
      </div>
    );
  }
  let tag, recText, cls, detail, blurb;
  if (result.kind === "twopoint") {
    tag = `TWO-POINT · ${result.meta.tier.toUpperCase()}`;
    recText = result.meta.text;
    cls = result.meta.cls;
    detail = result.detail;
    blurb = result.meta.blurb;
  } else if (result.kind === "penalty") {
    tag = "PENALTY";
    recText = result.decision === "DECLINE" ? "DECLINE" : "ACCEPT";
    cls = result.decision === "DECLINE" ? "go2" : "go1";
    detail = result.detail;
    blurb = result.reason;
  } else {
    // CLOCK — richer layout with time-left + outlook.
    return (
      <div className={`sa-card ${result.meta.cls}`}>
        <div className="sa-card-tag">CLOCK MANAGEMENT</div>
        <p className="sa-card-rec">{result.meta.text}</p>
        {result.warn && <p className="sa-card-warn">{result.warn}</p>}
        {!result.canEndIt && (
          <div className="sa-timeleft">
            <span className="sa-timeleft-num">{result.oppLeftStr}</span>
            <span className="sa-timeleft-lbl">opponent gets the ball back with roughly this much</span>
          </div>
        )}
        <p className="sa-card-blurb">{result.outlook}</p>
        <div className="sa-clock-why">
          <strong>Sideline use</strong>
          <span>{result.sidelineUse}</span>
        </div>
        {result.coachingFocus && <p className="sa-card-chain">{result.coachingFocus}</p>}
        {result.chainNote && <p className="sa-card-chain">{result.chainNote}</p>}
        <p className="sa-card-detail">{result.detail}</p>
      </div>
    );
  }
  return (
    <div className={`sa-card ${cls}`}>
      <div className="sa-card-tag">{tag}</div>
      <p className="sa-card-rec">{recText}</p>
      <p className="sa-card-blurb">{blurb}</p>
      <p className="sa-card-detail">{detail}</p>
    </div>
  );
}

/* ============================================================================
   STYLES
   Direction: a coach's call sheet meets a stadium scoreboard. Condensed
   uppercase display type, ink-on-field-green, one loud "amber light" accent
   for the live mic. Big tap targets, glove-friendly. No cream-serif defaults.
   ========================================================================== */
const CSS = `
.sa-root{
  --field:#0c2417; --field2:#0a1c12; --line:#1f4530;
  --chalk:#eef4ec; --mute:#9bb7a6; --amber:#ffb23e; --amber2:#ff8a00;
  --go2:#2f9e44; --lean2:#69c34a; --toss:#f4c542;
  --lean1:#f08c2e; --go1:#b3261e;
  --disp:'Barlow Condensed','Oswald','Roboto Condensed','Arial Narrow',system-ui,sans-serif;
  --body:'Barlow','Inter','Roboto',system-ui,-apple-system,sans-serif;
  font-family:var(--disp);
  max-width:480px;margin:0 auto;min-height:100%;position:relative;
  background:radial-gradient(120% 80% at 50% -10%,#143c25 0%,var(--field) 55%,var(--field2) 100%);
  color:var(--chalk);padding:18px 16px 30px;border-radius:18px;
}
.sa-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.sa-brand{display:flex;align-items:center;gap:11px}
.sa-tick{width:5px;height:38px;background:#fff;border-radius:2px;
  box-shadow:0 0 14px rgba(255,255,255,.42)}
.sa-brand h1{font-size:30px;font-weight:800;letter-spacing:3px;margin:0;line-height:.9;color:#fff}
.sa-brand p{font-family:var(--body);font-size:12px;color:var(--mute);
  margin:2px 0 0;letter-spacing:.3px}
.sa-mute{display:flex;align-items:center;gap:6px;background:transparent;
  border:1px solid var(--line);color:var(--mute);padding:7px 11px;border-radius:20px;
  font-family:var(--body);font-size:12px;cursor:pointer}
.sa-mute.on{color:var(--amber);border-color:var(--amber)}

.sa-mode-wrap{margin:18px 0 10px}
.sa-mode-label{font-family:var(--disp);font-size:12px;letter-spacing:1.8px;
  color:var(--mute);text-transform:uppercase;margin-bottom:8px;text-align:center}
.sa-mode-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sa-mode-tabs button{border:1px solid var(--line);background:rgba(255,255,255,.04);
  color:var(--chalk);border-radius:14px;padding:11px 8px;font-family:var(--body);
  font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;
  gap:6px;cursor:pointer;text-transform:uppercase}
.sa-mode-tabs button svg{color:var(--amber)}
.sa-mode-tabs button.on{background:var(--amber);border-color:var(--amber);color:#07120b}
.sa-mode-tabs button.on svg{color:#07120b}

.sa-input-switch{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 8px}
.sa-input-switch button{border:1px solid var(--line);background:rgba(255,255,255,.04);
  color:var(--mute);border-radius:14px;padding:10px 8px;font-family:var(--body);
  font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;cursor:pointer}
.sa-input-switch button.on{background:var(--amber);border-color:var(--amber);color:#07120b}
.sa-manual-panel{background:rgba(255,255,255,.05);border:1px solid var(--line);
  border-radius:16px;padding:14px;margin:14px 0 16px;animation:rise .25s ease}
.sa-manual-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
.sa-manual-head strong{display:block;font-size:17px;letter-spacing:.8px;text-transform:uppercase}
.sa-manual-head span{display:block;font-family:var(--body);font-size:12.5px;color:var(--mute);margin-top:2px;line-height:1.35}
.sa-mini-btn{display:flex;align-items:center;gap:5px;background:transparent;border:1px solid var(--line);
  color:var(--mute);border-radius:16px;padding:7px 10px;font-family:var(--body);font-size:12px;cursor:pointer;white-space:nowrap}
.sa-manual-grid{display:grid;gap:10px;margin-bottom:12px}
.sa-manual-grid.two{grid-template-columns:1fr 1fr}
.sa-manual-grid.clock{grid-template-columns:1fr 1fr}
.sa-manual-grid.penalty-box{grid-template-columns:1fr 1fr;margin-bottom:0}
.sa-manual-grid label{font-family:var(--body);font-size:12px;color:var(--mute);display:flex;flex-direction:column;gap:5px}
.sa-manual-grid select{width:100%;background:#0a1c12;border:1px solid var(--line);border-radius:12px;
  color:var(--chalk);padding:12px 12px;font-family:var(--body);font-size:14px;outline:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.02)}
.sa-manual-grid select:focus{border-color:var(--amber)}
.sa-manual-inline-top{display:grid;grid-template-columns:minmax(0,220px);margin-bottom:12px}
.sa-manual-sections{display:grid;gap:12px;margin-bottom:12px}
.sa-manual-sections.penalty{grid-template-columns:1fr}
.sa-manual-box{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px}
.sa-manual-box-title{font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--chalk);margin-bottom:3px}
.sa-manual-box-sub{font-family:var(--body);font-size:12px;line-height:1.35;color:var(--mute);margin-bottom:10px}
.sa-clock-help{font-family:var(--body);font-size:12.5px;line-height:1.35;color:rgba(255,255,255,.82);
  background:rgba(255,178,62,.10);border:1px solid rgba(255,178,62,.30);border-radius:12px;padding:10px 11px;margin-bottom:12px}
.sa-clock-help strong{color:var(--amber);letter-spacing:.4px}
.sa-manual-submit{width:100%;background:var(--amber);color:#1a0f00;border:none;border-radius:12px;
  padding:12px 14px;font-family:var(--body);font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;cursor:pointer}
.sa-manual-submit:active{transform:scale(.98)}

.sa-mic-wrap{display:flex;flex-direction:column;align-items:center;
  margin:18px 0 14px;gap:12px}
.sa-mic{position:relative;width:130px;height:130px;border-radius:50%;
  border:none;cursor:pointer;display:grid;place-items:center;
  background:linear-gradient(160deg,#1c5234,#0e2c1c);color:var(--chalk);
  box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 0 0 2px var(--line);
  transition:transform .12s ease}
.sa-mic:active{transform:scale(.96)}
.sa-mic:disabled{opacity:.5;cursor:not-allowed}
.sa-mic.live{background:linear-gradient(160deg,var(--amber),var(--amber2));
  color:#1a0f00;box-shadow:0 0 40px rgba(255,140,0,.55),inset 0 0 0 2px rgba(255,255,255,.3)}
.sa-mic-ring{position:absolute;inset:-10px;border-radius:50%;border:2px solid var(--amber);
  opacity:0;pointer-events:none}
.sa-mic.live .sa-mic-ring{animation:pulse 1.8s ease-out infinite}
.sa-mic.live .sa-mic-ring.r2{animation-delay:.9s}
@keyframes pulse{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(1.4)}}
.sa-mic-label{font-family:var(--body);font-size:14px;color:var(--mute);
  margin:0;text-align:center}

.sa-transcript{display:flex;align-items:flex-start;gap:8px;
  background:rgba(255,255,255,.05);border:1px solid var(--line);
  border-radius:12px;padding:10px 13px;margin:0 0 14px;
  font-family:var(--body);font-size:14px;color:var(--chalk)}
.sa-transcript svg{margin-top:2px;color:var(--amber);flex-shrink:0}

.sa-card{border-radius:16px;padding:18px 18px 16px;margin-bottom:16px;
  border:1px solid rgba(255,255,255,.14);position:relative;overflow:hidden;
  animation:rise .25s ease}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.sa-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px}
.sa-card-tag{font-size:12px;letter-spacing:2px;font-weight:700;color:rgba(255,255,255,.85);
  text-transform:uppercase}
.sa-card-rec{font-size:38px;font-weight:800;letter-spacing:1px;margin:4px 0 6px;
  line-height:.95;text-transform:uppercase}
.sa-card-blurb{font-family:var(--body);font-size:15px;margin:0 0 8px;
  color:rgba(255,255,255,.92);line-height:1.35}
.sa-card-warn{font-family:var(--body);font-size:13.5px;font-weight:600;
  margin:0 0 10px;padding:9px 11px;border-radius:9px;line-height:1.35;
  background:rgba(255,178,62,.16);border:1px solid rgba(255,178,62,.45);
  color:#ffd99a}
.sa-timeleft{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;
  padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.22);
  border:1px solid rgba(255,255,255,.12)}
.sa-timeleft-num{font-size:30px;font-weight:800;letter-spacing:1px;line-height:1;
  color:#fff;font-variant-numeric:tabular-nums}
.sa-timeleft-lbl{font-family:var(--body);font-size:12px;line-height:1.25;
  color:rgba(255,255,255,.72)}
.sa-card-chain{font-family:var(--body);font-size:13px;margin:0 0 8px;
  padding-left:10px;border-left:2px solid rgba(255,255,255,.25);
  color:rgba(255,255,255,.78);line-height:1.35}
.sa-clock-why{font-family:var(--body);font-size:13px;line-height:1.35;margin:0 0 9px;
  padding:10px 11px;border-radius:10px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.11)}
.sa-clock-why strong{display:block;font-size:11px;letter-spacing:1.1px;text-transform:uppercase;color:rgba(255,255,255,.82);margin-bottom:3px}
.sa-clock-why span{display:block;color:rgba(255,255,255,.78)}
.sa-card-detail{font-family:var(--body);font-size:12.5px;margin:0;
  color:rgba(255,255,255,.7)}
.sa-card.go2,.sa-card.lean2,.sa-card.lgm-none,.sa-card.lgm-modest{background:linear-gradient(155deg,#1c5a30,#123c20)}
.sa-card.go2::before,.sa-card.lgm-none::before{background:var(--go2)}
.sa-card.lean2::before,.sa-card.lgm-modest::before{background:var(--lean2)}
.sa-card.toss{background:linear-gradient(155deg,#5a4d18,#3c3310)}
.sa-card.toss::before{background:var(--toss)}
.sa-card.lean1,.sa-card.lgm-mod{background:linear-gradient(155deg,#5a3618,#3c2410)}
.sa-card.lean1::before,.sa-card.lgm-mod::before{background:var(--lean1)}
.sa-card.go1,.sa-card.lgm-sev{background:linear-gradient(155deg,#5a1c18,#3c1210)}
.sa-card.go1::before,.sa-card.lgm-sev::before{background:var(--go1)}
.sa-card.lgm-delay{background:linear-gradient(155deg,#3a2a52,#241634)}
.sa-card.lgm-delay::before{background:#7a52c4}
.sa-card.lgm-knee{background:linear-gradient(155deg,#2e1c52,#1a1034)}
.sa-card.lgm-knee::before{background:#8c52c4}
.sa-card.err{background:rgba(255,255,255,.05)}
.sa-card.err::before{background:var(--mute)}

.sa-type{display:flex;gap:8px;margin-bottom:16px}
.sa-type input{flex:1;background:rgba(255,255,255,.06);border:1px solid var(--line);
  border-radius:11px;padding:12px 14px;color:var(--chalk);
  font-family:var(--body);font-size:15px;outline:none}
.sa-type input:focus{border-color:var(--amber)}
.sa-type input::placeholder{color:var(--mute)}
.sa-type button{background:var(--amber);color:#1a0f00;border:none;border-radius:11px;
  padding:0 20px;font-weight:700;font-size:16px;letter-spacing:1px;cursor:pointer;
  text-transform:uppercase}
.sa-type button:active{transform:scale(.97)}

.sa-examples-head{font-family:var(--disp);font-size:12px;letter-spacing:1.8px;color:var(--mute);text-transform:uppercase;margin:4px 0 8px}
.sa-examples{display:flex;flex-direction:column;gap:8px;margin-bottom:18px}
.sa-ex{display:flex;align-items:center;gap:11px;text-align:left;
  background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:12px;
  padding:11px 13px;color:var(--chalk);cursor:pointer;transition:border-color .15s}
.sa-ex:hover,.sa-ex.on{border-color:var(--amber)}
.sa-ex.on{background:rgba(255,178,62,.08)}
.sa-ex svg{color:var(--amber);flex-shrink:0}
.sa-ex strong{display:block;font-size:15px;letter-spacing:.5px;text-transform:uppercase}
.sa-ex span{display:block;font-family:var(--body);font-size:12.5px;color:var(--mute)}

@media (max-width:520px){
  .sa-manual-grid.two,.sa-manual-grid.clock,.sa-manual-grid.penalty-box{grid-template-columns:1fr}
  .sa-manual-inline-top{grid-template-columns:1fr}
  .sa-manual-head{flex-direction:column}
  .sa-mini-btn{align-self:flex-start}
}

.sa-foot{font-family:var(--body);font-size:11.5px;color:var(--mute);
  text-align:center;line-height:1.4;border-top:1px solid var(--line);padding-top:14px}

.sa-head-ctrls{display:flex;gap:8px}
.sa-modal{position:absolute;inset:0;z-index:50;background:rgba(4,12,8,.82);
  display:flex;align-items:flex-start;justify-content:center;padding:14px;
  border-radius:18px;overflow:auto;animation:fade .15s ease}
@keyframes fade{from{opacity:0}to{opacity:1}}
.sa-modal-inner{background:var(--field);border:1px solid var(--line);
  border-radius:16px;width:100%;max-width:452px;padding:12px;margin:auto}
.sa-modal-head{display:flex;justify-content:space-between;align-items:center;
  margin-bottom:10px}
.sa-modal-tabs{display:flex;gap:6px}
.sa-modal-tabs button{display:flex;align-items:center;gap:5px;background:transparent;
  border:1px solid var(--line);color:var(--mute);padding:7px 12px;border-radius:18px;
  font-family:var(--body);font-size:13px;cursor:pointer}
.sa-modal-tabs button.on{color:#1a0f00;background:var(--amber);border-color:var(--amber);
  font-weight:600}
.sa-modal-x{background:transparent;border:none;color:var(--mute);cursor:pointer;
  padding:4px;display:flex}
.sa-grid{display:grid;gap:2px;width:100%}
.sa-grid-clock{grid-template-columns:46px repeat(4,1fr)}
.sa-grid-2pt{grid-template-columns:34px repeat(7,1fr)}
.sa-gh{font-size:11px;font-weight:700;letter-spacing:.5px;color:var(--mute);
  text-align:center;padding:4px 0;text-transform:uppercase}
.sa-gh-sm{font-size:9px;letter-spacing:0}
.sa-gh-corner{text-align:left;padding-left:2px}
.sa-grow-label{font-size:11px;font-weight:700;color:var(--chalk);
  display:flex;align-items:center;justify-content:flex-end;padding-right:5px;
  font-variant-numeric:tabular-nums}
.sa-cell{border:none;border-radius:3px;cursor:pointer;color:#0a1c12;
  font-family:var(--body);font-weight:700;font-size:11px;height:26px;
  display:flex;align-items:center;justify-content:center;
  font-variant-numeric:tabular-nums;transition:transform .08s}
.sa-cell:active{transform:scale(.9)}
.sa-cell-sm{height:15px;border-radius:2px}
.sa-glegend{display:flex;flex-wrap:wrap;gap:9px;margin:11px 0 0;
  font-family:var(--body);font-size:11px;color:var(--mute)}
.sa-glegend span{display:flex;align-items:center;gap:4px}
.sa-glegend i{width:11px;height:11px;border-radius:2px;display:inline-block}
.sa-grid-note{font-family:var(--body);font-size:11.5px;color:var(--mute);
  line-height:1.4;margin:9px 0 2px}

.sa-log-title{display:flex;align-items:center;gap:6px;font-family:var(--body);
  font-size:14px;font-weight:600;color:var(--chalk)}
.sa-log-head-btns{display:flex;align-items:center;gap:8px}
.sa-log-clear{display:flex;align-items:center;gap:4px;background:transparent;
  border:1px solid var(--line);color:var(--mute);padding:6px 10px;border-radius:16px;
  font-family:var(--body);font-size:12px;cursor:pointer}
.sa-log-warn{display:flex;align-items:center;gap:6px;font-family:var(--body);
  font-size:11.5px;color:var(--mute);margin-bottom:10px;padding:7px 9px;
  background:rgba(255,255,255,.04);border-radius:8px}
.sa-log-empty{font-family:var(--body);font-size:14px;color:var(--mute);
  text-align:center;padding:24px 10px}
.sa-log-list{display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow:auto}
.sa-log-row{display:flex;align-items:center;gap:10px;padding:9px 10px;
  background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:10px}
.sa-log-pill{flex-shrink:0;font-size:11px;font-weight:700;letter-spacing:.5px;
  padding:5px 9px;border-radius:7px;text-transform:uppercase;color:#fff;min-width:64px;
  text-align:center}
.sa-log-pill.go2{background:var(--go2)}
.sa-log-pill.lean2{background:var(--lean2);color:#0a1c12}
.sa-log-pill.toss{background:var(--toss);color:#1a0f00}
.sa-log-pill.lean1{background:var(--lean1);color:#1a0f00}
.sa-log-pill.go1{background:var(--go1)}
.sa-log-pill.lgm-none{background:var(--go2)}
.sa-log-pill.lgm-modest{background:#a7c34a;color:#0a1c12}
.sa-log-pill.lgm-mod{background:var(--lean1);color:#1a0f00}
.sa-log-pill.lgm-sev{background:var(--go1)}
.sa-log-pill.lgm-delay{background:#3b6fd4}
.sa-log-pill.lgm-knee{background:#7a3bd4}
.sa-log-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.sa-log-sit{font-family:var(--body);font-size:13.5px;color:var(--chalk);line-height:1.25}
.sa-log-time{font-family:var(--body);font-size:11px;color:var(--mute)}
`;