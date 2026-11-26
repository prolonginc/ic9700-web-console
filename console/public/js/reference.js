// What the Cheat sheets tab shows: the codes and shorthand heard on the air,
// the phonetic alphabet, signal reports, and which bands each United States
// license class may use.

// ------------------------------------------------------------------ Q codes
//
// Three-letter codes from the days of Morse, now said on voice too. Each is a
// statement, or a question if asked as one ("QSY?" is "shall I change
// frequency?").

export const Q_CODES = [
  ['QRG', 'Exact frequency', '“What’s your QRG?” asks which frequency you are on.'],
  ['QRL', 'This frequency is in use', 'Ask “QRL?” (on voice, “is this frequency in use?”) before calling on a frequency that sounds empty.'],
  ['QRM', 'Interference from other stations', '“I’m getting QRM” means someone else’s signal is covering yours.'],
  ['QRN', 'Static and electrical noise', 'Crackle from storms, power lines or electronics, as opposed to other stations.'],
  ['QRO', 'High power', 'Running more power, or a request to turn it up.'],
  ['QRP', 'Low power', 'By custom 5 watts or less. Also a request to turn the power down.'],
  ['QRQ', 'Send faster', 'Morse only.'],
  ['QRS', 'Send slower', 'Morse only. Nobody minds being asked.'],
  ['QRT', 'Closing down', '“I’m going QRT” means switching off for now.'],
  ['QRU', 'Nothing more for you', 'I have no more messages to pass.'],
  ['QRV', 'Ready', '“I’m QRV on 70 centimeters” means set up and able to operate there.'],
  ['QRX', 'Stand by', '“QRX five” means wait, back in five minutes.'],
  ['QRZ', 'Who is calling me?', 'Said when you heard someone call but missed their call sign. Often written “QRZ?”.'],
  ['QSB', 'Fading', 'The signal is rising and falling in strength.'],
  ['QSK', 'Full break-in', 'Morse: able to hear the other station between one’s own dots and dashes.'],
  ['QSL', 'Received and understood', 'Also the card or online record that confirms a contact took place.'],
  ['QSO', 'A contact', 'A conversation on the air. “Thanks for the QSO.”'],
  ['QSP', 'Relay', 'Pass a message on to a third station.'],
  ['QST', 'Calling all amateurs', 'Begins a bulletin meant for everyone. Also the name of the ARRL’s magazine.'],
  ['QSX', 'Listening on another frequency', '“QSX 146.55” means I am listening there, not here.'],
  ['QSY', 'Change frequency', '“Let’s QSY to 146.55” means move there to carry on, usually to free a calling frequency or a repeater.'],
  ['QTC', 'Messages to pass', '“I have QTC for you” means there is formal traffic waiting.'],
  ['QTH', 'Location', '“My QTH is Springfield.”'],
  ['QTR', 'The time', 'Usually given in UTC.'],
];

// ---------------------------------------------------------------- Shorthand
//
// Abbreviations from Morse, where every letter costs effort. Many are also
// said aloud or typed in logs and digital modes.

export const SHORTHAND = [
  ['CQ', 'Calling any station', 'An invitation for anyone to answer. “CQ CQ CQ, this is…”'],
  ['DE', 'From', '“W1AW DE N0CALL”: W1AW, this is N0CALL.'],
  ['K', 'Go ahead', 'Over to you; anyone may answer.'],
  ['KN', 'Go ahead, you only', 'Over to the station named; others please wait.'],
  ['BK', 'Break', 'A quick hand-over without call signs, or a request to interrupt.'],
  ['R', 'Received', 'I got all of that. “Roger” on voice.'],
  ['AR', 'End of message', 'Sent as one character. More may follow from the other station.'],
  ['SK', 'End of contact', 'Sent as one character: this is my last transmission. “Silent key” also means a ham who has died.'],
  ['AS', 'Wait', 'Sent as one character.'],
  ['CL', 'Closing', 'Switching the station off.'],
  ['73', 'Best regards', 'The usual way to sign off. Never “73s”: it is already plural.'],
  ['88', 'Love and kisses', 'Signing off to family or a close friend.'],
  ['RST', 'Signal report', 'Readability, strength and tone. See the Signal reports sheet.'],
  ['599', 'Perfect signal', 'Also sent as 5NN. In contests everybody is 599, whatever the truth.'],
  ['TU', 'Thank you', 'Also TNX or TKS.'],
  ['PSE', 'Please', ''],
  ['FB', 'Fine business', 'Great, excellent.'],
  ['OM', 'Old man', 'Any fellow ham, of any age.'],
  ['YL', 'Young lady', 'A woman operator, of any age.'],
  ['XYL', 'Wife', '“Ex-young-lady.”'],
  ['HI', 'Laughter', 'The Morse way to laugh. “HI HI.”'],
  ['WX', 'Weather', ''],
  ['DX', 'Distant station', 'A far-off contact, or the pursuit of them.'],
  ['RIG', 'Radio', 'The transceiver.'],
  ['ANT', 'Antenna', ''],
  ['PWR', 'Power', ''],
  ['UR', 'Your, or you are', '“UR RST 579.”'],
  ['ES', 'And', ''],
  ['HR', 'Here', '“WX HR IS COLD.”'],
  ['HW', 'How', '“HW?” asks how well you are receiving me.'],
  ['AGN', 'Again', '“PSE AGN”: please repeat.'],
  ['NR', 'Number', ''],
  ['B4', 'Before', '“WKD B4”: we have had a contact already.'],
  ['C', 'Yes', 'Also “correct”. N is no.'],
  ['CFM', 'Confirm', ''],
  ['WKD', 'Worked', 'Made contact with.'],
  ['GM', 'Good morning', 'GA is good afternoon, GE good evening, GN good night.'],
  ['GL', 'Good luck', ''],
  ['CUL', 'See you later', ''],
  ['SRI', 'Sorry', ''],
  ['VY', 'Very', '“VY 73.”'],
  ['TEST', 'Contest', '“CQ TEST” is a call for contest contacts only.'],
];

// ------------------------------------------------------------- On the air
//
// Words heard on repeaters and in voice contacts.

export const VOICE_WORDS = [
  ['Monitoring', 'I am here and listening', 'Said with your call sign on a repeater to show you are open to a chat: “N0CALL monitoring.” Also “listening”.'],
  ['Over', 'Your turn', 'I have finished this transmission and expect a reply.'],
  ['Clear', 'I am finished here', '“N0CALL clear” ends your part in a contact and frees the frequency.'],
  ['Break', 'May I come in?', 'Said between other people’s transmissions to join in or to pass something quickly. “Break break” or “emergency” means it cannot wait.'],
  ['Go ahead', 'I am listening for you', 'An invitation to transmit.'],
  ['Roger', 'Received and understood', 'Not the same as “yes”.'],
  ['Copy', 'Hear and understand', '“Do you copy?” “I copy you fine.”'],
  ['Say again', 'Please repeat', 'The usual phrase. “Repeat” is avoided in some services.'],
  ['Stand by', 'Wait a moment', ''],
  ['Affirmative', 'Yes', '“Negative” is no.'],
  ['Simplex', 'Radio to radio', 'Talking directly, on one frequency, with no repeater between.'],
  ['Offset', 'The repeater’s frequency shift', 'Also “shift” or “split”: how far your transmit frequency sits from the one you listen on.'],
  ['PL tone', 'Access tone', 'The low hum a repeater needs to hear before it relays you. Also “CTCSS” or just “tone”.'],
  ['Machine', 'A repeater', '“I’ll be on the 94 machine.”'],
  ['Courtesy tone', 'The repeater’s beep', 'It sounds when someone lets go of the key. Wait for it before you transmit, so others can break in.'],
  ['Kerchunk', 'Keying a repeater without speaking', 'Done to see if it answers. Poor form without giving a call sign.'],
  ['Timed out', 'Cut off by the repeater', 'Most repeaters stop relaying anyone who talks for more than about three minutes without a pause.'],
  ['Full quieting', 'A perfect FM signal', 'Strong enough that there is no hiss behind the voice at all.'],
  ['Scratchy', 'A weak FM signal', 'Hiss and crackle on the voice. “Picket fencing” is the flutter of a moving station.'],
  ['Doubling', 'Two stations at once', 'Both transmitted together and neither was heard.'],
  ['Net', 'A scheduled gathering', 'An on-air meeting at a set time, run by a “net control” station who calls for “check-ins”.'],
  ['Traffic', 'Messages to pass', '“No traffic” when you check in means you have nothing to pass on.'],
  ['Ragchew', 'A long, relaxed chat', ''],
  ['Handle', 'First name', '“The handle here is Sam.”'],
  ['Elmer', 'A mentor', 'An experienced ham who helps a newcomer.'],
  ['Ticket', 'License', ''],
  ['HT', 'Handheld radio', 'Short for “handie-talkie”.'],
  ['Mobile', 'Operating from a vehicle', '“Portable” is away from home on temporary equipment; “base” is the home station.'],
  ['Barefoot', 'No amplifier', 'Running just the radio’s own power.'],
  ['Five nine', 'A perfect voice report', 'Fully readable and very strong. See the Signal reports sheet.'],
  ['Eyeball', 'A meeting in person', '“An eyeball QSO.”'],
];

// ---------------------------------------------------------------- Phonetics
//
// The standard (ITU) words, used so that letters survive a noisy signal.

export const PHONETICS = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India',
  J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
  0: 'Zero', 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Niner',
  '/': 'Stroke',
};

// "N0CALL" → "November Zero Charlie Alfa Lima Lima"
export function spellOut(text) {
  return [...String(text).toUpperCase()]
    .map((c) => PHONETICS[c])
    .filter(Boolean)
    .join(' ');
}

// ----------------------------------------------------------- Signal reports

export const READABILITY = [
  ['1', 'Unreadable'],
  ['2', 'Barely readable, a word now and then'],
  ['3', 'Readable with considerable difficulty'],
  ['4', 'Readable with practically no difficulty'],
  ['5', 'Perfectly readable'],
];

export const STRENGTH = [
  ['1', 'Faint, barely perceptible'],
  ['2', 'Very weak'],
  ['3', 'Weak'],
  ['4', 'Fair'],
  ['5', 'Fairly good'],
  ['6', 'Good'],
  ['7', 'Moderately strong'],
  ['8', 'Strong'],
  ['9', 'Extremely strong'],
];

export const TONE = [
  ['1 to 3', 'Rough, buzzing or hissing'],
  ['4 to 6', 'Some roughness or ripple'],
  ['7 to 8', 'Nearly pure'],
  ['9', 'A perfectly pure tone'],
];

// -------------------------------------------------------- License privileges
//
// United States: 47 CFR Part 97 (the FCC's amateur rules), sections 97.301,
// 97.303, 97.305 and 97.313, read from the eCFR as current in November 2026
// and compared with the ARRL's band chart. That includes the 60 meter rules
// that took effect on February 13, 2026. Rules change: this is a study aid,
// not the rules.
//
// Only the three classes still issued are shown. Each row is a stretch of a
// band with one set of rules. For each class: true (may use it as described),
// false (may not), or a note where the class is held to less.

export const LICENSES = [
  { id: 'technician', name: 'Technician' },
  { id: 'general', name: 'General' },
  { id: 'extra', name: 'Amateur Extra' },
];

export const PRIVILEGES_CHECKED = 'November 2026';
export const PRIVILEGES_SOURCE = 'https://www.arrl.org/graphical-frequency-allocations';
export const PRIVILEGES_RULES = 'https://www.ecfr.gov/current/title-47/part-97';

const MORSE_DATA = 'Morse and data';
const VOICE = 'Voice and image';
const ALL = 'All modes';
const TECH_MORSE = 'Morse only, 200 W';

// [range in MHz, what it is for, technician, general, extra]
export const PRIVILEGES = [
  { band: '160 m', rows: [['1.800–2.000', ALL, false, true, true]] },
  {
    band: '80 m',
    rows: [
      ['3.500–3.525', MORSE_DATA, false, false, true],
      ['3.525–3.600', MORSE_DATA, TECH_MORSE, true, true],
      ['3.600–3.800', VOICE, false, false, true],
      ['3.800–4.000', VOICE, false, true, true],
    ],
  },
  { band: '60 m', rows: [['5.3515–5.3665', 'Morse, voice and data, about 9 W', false, true, true]] },
  {
    band: '40 m',
    rows: [
      ['7.000–7.025', MORSE_DATA, false, false, true],
      ['7.025–7.125', MORSE_DATA, TECH_MORSE, true, true],
      ['7.125–7.175', VOICE, false, false, true],
      ['7.175–7.300', VOICE, false, true, true],
    ],
  },
  { band: '30 m', rows: [['10.100–10.150', 'Morse and data, 200 W', false, true, true]] },
  {
    band: '20 m',
    rows: [
      ['14.000–14.025', MORSE_DATA, false, false, true],
      ['14.025–14.150', MORSE_DATA, false, true, true],
      ['14.150–14.225', VOICE, false, false, true],
      ['14.225–14.350', VOICE, false, true, true],
    ],
  },
  {
    band: '17 m',
    rows: [
      ['18.068–18.110', MORSE_DATA, false, true, true],
      ['18.110–18.168', VOICE, false, true, true],
    ],
  },
  {
    band: '15 m',
    rows: [
      ['21.000–21.025', MORSE_DATA, false, false, true],
      ['21.025–21.200', MORSE_DATA, TECH_MORSE, true, true],
      ['21.200–21.275', VOICE, false, false, true],
      ['21.275–21.450', VOICE, false, true, true],
    ],
  },
  {
    band: '12 m',
    rows: [
      ['24.890–24.930', MORSE_DATA, false, true, true],
      ['24.930–24.990', VOICE, false, true, true],
    ],
  },
  {
    band: '10 m',
    rows: [
      ['28.000–28.300', MORSE_DATA, '200 W', true, true],
      ['28.300–28.500', VOICE, 'Sideband voice and Morse, 200 W', true, true],
      ['28.500–29.700', VOICE, false, true, true],
    ],
  },
  {
    band: '6 m',
    rows: [
      ['50.0–50.1', 'Morse only', true, true, true],
      ['50.1–54.0', ALL, true, true, true],
    ],
  },
  {
    band: '2 m',
    thisRadio: true,
    rows: [
      ['144.0–144.1', 'Morse only', true, true, true],
      ['144.1–148.0', ALL, true, true, true],
    ],
  },
  { band: '1.25 m', rows: [['222–225', ALL, true, true, true]] },
  {
    band: '70 cm',
    thisRadio: true,
    rows: [
      ['420–430', 'All modes, but not near the Canadian border', true, true, true],
      ['430–450', ALL, true, true, true],
    ],
  },
  { band: '33 cm', rows: [['902–928', ALL, true, true, true]] },
  { band: '23 cm', thisRadio: true, rows: [['1240–1300', ALL, true, true, true]] },
];

// ------------------------------------------------------------------ Line A
//
// North of "Line A" no amateur station may transmit between 420 and 430 MHz
// (47 CFR 97.303(m)(1)). The line is defined in 97.3(a)(30): from Aberdeen,
// Washington, by great circle to 48° N 120° W; along 48° N to 95° W; by great
// circle through the southernmost point of Duluth, Minnesota, to 45° N 85° W;
// south along 85° W to 41° N; east along 41° N to 82° W; then by great circle
// through the southernmost points of Bangor and Searsport, Maine, where it
// ends. It concerns the contiguous United States only.
//
// The towns are given here to within a few kilometres, so a place that close
// to the line gets "near" rather than a firm answer.

const LINE_A = [
  [46.975, -123.815], // Aberdeen, WA
  [48, -120],
  [48, -95],
  [46.66, -92.28], // southernmost Duluth, MN
  [45, -85],
  [41, -85],
  [41, -82],
  [44.77, -68.8], // southernmost Bangor, ME
];
const LINE_A_MARGIN = 0.2; // degrees of latitude, about 22 km

// The latitude at which the great circle through a and b crosses `lon`.
function greatCircleLatitude(a, b, lon) {
  const rad = Math.PI / 180;
  const t = (Math.tan(a[0] * rad) * Math.sin((b[1] - lon) * rad) + Math.tan(b[0] * rad) * Math.sin((lon - a[1]) * rad)) / Math.sin((b[1] - a[1]) * rad);
  return Math.atan(t) / rad;
}

// Which side of Line A a place is on: 'north', 'south' or 'near' (too close
// to say, or beyond the line's eastern end in Maine).
export function sideOfLineA(lat, lon) {
  // Outside the contiguous United States the line does not apply.
  if (!(lat >= 24 && lat <= 49.5 && lon >= -125 && lon <= -66)) return 'south';
  if (lat < 41 - LINE_A_MARGIN) return 'south';
  let lineLat;
  if (lon <= -120) lineLat = lon < LINE_A[0][1] ? LINE_A[0][0] : greatCircleLatitude(LINE_A[0], LINE_A[1], lon);
  else if (lon <= -95) lineLat = 48;
  else if (lon <= LINE_A[3][1]) lineLat = greatCircleLatitude(LINE_A[2], LINE_A[3], lon);
  else if (lon < -85) lineLat = greatCircleLatitude(LINE_A[3], LINE_A[4], lon);
  else if (lon <= -82) lineLat = 41;
  else if (lon <= LINE_A[7][1]) lineLat = greatCircleLatitude(LINE_A[6], LINE_A[7], lon);
  else return lat > 44 ? 'near' : 'south'; // east of where the line ends
  // Just east of 85° W the line runs north-south, so being close to that
  // meridian is being close to the line, whatever the latitude.
  if (lat > 41 && lat < 45 + LINE_A_MARGIN && Math.abs(lon + 85) < LINE_A_MARGIN * 1.4) return 'near';
  if (Math.abs(lat - lineLat) < LINE_A_MARGIN) return 'near';
  return lat > lineLat ? 'north' : 'south';
}

// Stretches of this radio's bands where the rules allow only some modes.
// Used to warn before transmitting there in another mode.
export const MODE_LIMITS = [{ start: 144.0e6, end: 144.1e6, modes: ['CW', 'CW-R'], text: 'Between 144.0 and 144.1 MHz, US rules allow Morse (CW) only.' }];

export function modeLimitAt(hz, mode) {
  const limit = MODE_LIMITS.find((l) => hz >= l.start && hz < l.end);
  return limit && !limit.modes.includes(mode) ? limit : null;
}
