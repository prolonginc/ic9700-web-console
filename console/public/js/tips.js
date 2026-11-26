// Beginner tips: the plain-language explanation shown when you hover over or
// tab to a control. Add `data-tip="key"` to an element to give it one, or set
// `data-tip-title` / `data-tip-body` directly for text built at run time.

export const TIPS = {
  // --- Top bar ---
  link: {
    title: 'Connection',
    body: 'Green means this page is talking to your radio. If it turns grey, check that the radio is switched on and connected to your network.',
  },
  tipsToggle: {
    title: 'Beginner tips',
    body: 'These pop-up explanations. Switch them off once you know your way around; you can turn them back on any time.',
  },
  fullPanel: {
    title: 'Full control panel',
    body: 'Opens wfweb’s own page, which has every setting this page leaves out: radio memories, digital modes, the Morse keyer and more.',
  },
  phone: {
    title: 'Use on a phone',
    body: 'Shows the address for opening this console on a phone or tablet on your home network, and how to switch that on.',
  },

  // --- Second receiver ---
  second: {
    title: 'Second receiver',
    body: 'This radio has two receivers. The second can listen on another band while you use the main one, so you can keep an ear on a repeater or a calling frequency. It only listens: you always transmit on the main one.',
  },
  secondToggle: {
    title: 'Second receiver on or off',
    body: 'Switches the second receiver on. The radio’s own screen calls this Dualwatch.',
  },
  secondFreq: {
    title: 'Second receiver frequency',
    body: 'Where the second receiver listens. Click to type a new one. It has to be on a different band from the main receiver.',
  },
  secondVolume: {
    title: 'Second receiver volume',
    body: 'How loud the second receiver is next to the main one, on this computer. At zero you hear the main receiver only.',
  },
  secondSwap: {
    title: 'Swap with main',
    body: 'The two receivers trade places. What the second was listening to becomes the main frequency, the one you can transmit on.',
  },

  // --- Tabs ---
  tabRepeaters: {
    title: 'Repeaters',
    body: 'Your own list of local repeaters, imported from a file. Click one to tune to it with its shift and tone set for you.',
  },
  tabSatellites: {
    title: 'Satellites',
    body: 'When the space station and the amateur satellites will pass over you, and following one with the radio as it goes by.',
  },
  tabLogbook: {
    title: 'Logbook',
    body: 'A record of who you talked to, when, and on what frequency. In most countries keeping one is a tradition rather than a rule, and it is how contacts get confirmed for awards.',
  },

  tabMorse: {
    title: 'Morse',
    body: 'Reads Morse code off the air and writes it out. Hams call Morse “CW”.',
  },
  morseToggle: {
    title: 'Read Morse',
    body: 'Listens to the radio’s sound for a tone being keyed on and off, works out how fast it is being sent, and writes the letters. It works in any mode: in CW for Morse signals, in FM for the call sign a repeater sends.',
  },
  morseLamp: {
    title: 'Keying light',
    body: 'Lit while the tone is on. If it flickers in step with the Morse you hear, the signal is being followed.',
  },

  tabSheets: {
    title: 'Cheat sheets',
    body: 'The things a newcomer has to look up: Q codes such as QSY, on-air shorthand, the phonetic alphabet, signal reports, and which bands your license covers.',
  },
  sheetSearch: {
    title: 'Look it up',
    body: 'Type a code you heard, such as QRZ or 73, or a word such as “frequency”, to find it in any of the sheets.',
  },
  sheetCall: {
    title: 'Your call sign',
    body: 'The call sign on your license. With it filled in, the examples in these sheets use it, so you can read them out as they are. It is the same one the Logbook uses.',
  },
  license: {
    title: 'Your license',
    body: 'The class of your United States amateur license. It picks out your column in the chart. It does not change what the radio will do: staying inside your privileges is up to you.',
  },
  spell: {
    title: 'Spell it out',
    body: 'Turns a call sign or a word into the phonetic words to say on the air. It starts with your own call sign, if you have entered one.',
  },

  // --- Scan ---
  scan: {
    title: 'Scan',
    body: 'Steps through a list of frequencies and stops when someone is talking, like the seek button on a car radio. It waits while the conversation lasts and moves on four seconds after it ends. Set the squelch first, so that empty channels are silent.',
  },
  scanFavorites: {
    title: 'Scan favorites',
    body: 'Goes round your saved frequencies.',
  },
  scanRepeaters: {
    title: 'Scan repeaters',
    body: 'Goes round the repeaters in your imported list that are on this band.',
  },
  scanBand: {
    title: 'Scan this part of the band',
    body: 'Steps through the part of the band you are in, one tuning step at a time. Set Step to the local channel spacing first: often 15 or 20 kHz on 2 meters and 25 kHz on 70 centimeters.',
  },

  // --- Repeater list ---
  repeaterImport: {
    title: 'Import a list',
    body: 'Reads a file of repeaters exported from RepeaterBook or made with CHIRP. The list stays on this computer.',
  },

  // --- Satellites ---
  satLocation: {
    title: 'Your location',
    body: 'Pass times depend on where you are. A grid square is the short code hams use for a location, such as FN31. Yours is kept on this computer.',
  },
  satRefresh: {
    title: 'Refresh',
    body: 'Fetches the latest orbit data. Satellites drift, so predictions from data more than a week or two old go wrong.',
  },
  satTrack: {
    title: 'Track this satellite',
    body: 'Sets the radio up for it: listening on the satellite’s downlink, transmitting on its uplink with the right tone, and keeping both corrected as the satellite’s motion shifts them. Press it before the pass starts so you are ready.',
  },
  satStop: {
    title: 'Stop tracking',
    body: 'Leaves satellite mode and puts the radio back on the frequencies it was on before.',
  },

  // --- Logbook ---
  logContact: {
    title: 'Log this contact',
    body: 'Opens the logbook with the time, frequency and mode already filled in. You add the other station’s call sign.',
  },
  myCall: {
    title: 'Your call sign',
    body: 'The call sign on your license. It is written into the exported file so logging sites know whose contacts these are.',
  },
  logExport: {
    title: 'Export the logbook',
    body: 'Downloads it as an ADIF file, the format that Logbook of The World, QRZ, eQSL and logging programs import.',
  },
  logCall: {
    title: 'Their call sign',
    body: 'The call sign of the station you talked to, as they gave it on the air.',
  },
  logTime: {
    title: 'When',
    body: 'The time of the contact, in your local time. It is stored and exported in UTC, the worldwide time hams log in.',
  },
  logFreq: {
    title: 'Frequency',
    body: 'Filled in from the radio. Change it if you are writing up an earlier contact.',
  },
  logSent: {
    title: 'Report you gave',
    body: 'How well you heard them. On voice it is two digits: how readable, from 1 to 5, then how strong, from 1 to 9. “59” means perfectly readable and very strong.',
  },
  logRcvd: {
    title: 'Report you got',
    body: 'What they said about your signal, in the same two digits.',
  },

  // --- Tuning ---
  freq: {
    title: 'Frequency',
    body: 'Your spot on the dial, in megahertz (MHz). Everyone tuned to the same frequency can hear each other. Click the number to type a new one.',
  },
  tuneDown: {
    title: 'Tune down',
    body: 'Moves down the band by one step. The left arrow key does the same, and so does scrolling over the waterfall.',
  },
  tuneUp: {
    title: 'Tune up',
    body: 'Moves up the band by one step. The right arrow key does the same, and so does scrolling over the waterfall.',
  },
  step: {
    title: 'Tuning step',
    body: 'How far each press moves you. FM channels sit 5 kHz or more apart, so big steps work there. Sideband voice and Morse need fine 100 Hz steps to sound right.',
  },

  // --- Display ---
  bandmap: {
    title: 'Band map',
    body: 'Hams have agreed to use different parts of each band for different things. The colors show what you are likely to find where. Click anywhere on the map to jump there.',
  },
  spectrum: {
    title: 'Spectrum',
    body: 'Signal strength across the slice of band on screen, right now. Peaks are stations. The low fuzzy line is background noise.',
  },
  waterfall: {
    title: 'Waterfall',
    body: 'The same slice of band over time, newest at the top. A bright vertical streak is someone transmitting. Click a streak to tune to it.',
  },
  zoomIn: {
    title: 'Zoom in',
    body: 'Shows a narrower slice of the band around your frequency, so signals look wider and are easier to tune exactly. Pinching on a trackpad also zooms.',
  },
  zoomOut: {
    title: 'Zoom out',
    body: 'Shows a wider slice of the band, up to 1 MHz across. Good for spotting where the activity is.',
  },

  // --- Bands ---
  'band-2m': {
    title: '2 meter band, 144 to 148 MHz',
    body: 'The most popular band for local contacts. Signals travel roughly as far as your antenna can “see”, often tens of miles, and much farther through a repeater. The best place to start.',
  },
  'band-70cm': {
    title: '70 centimeter band, 420 to 450 MHz',
    body: 'A little less range than 2 meters, but it gets in and out of buildings well. Plenty of repeaters and digital voice.',
  },
  'band-23cm': {
    title: '23 centimeter band, 1240 to 1300 MHz',
    body: 'A quieter microwave band popular with experimenters. It needs its own antenna, and the radio puts out at most 10 watts here.',
  },

  // --- Modes ---
  'mode-FM': {
    title: 'FM',
    body: 'Clear, steady voice. The normal mode for repeaters and local chat on these bands. If in doubt, use FM.',
  },
  'mode-DV': {
    title: 'DV, digital voice (D-STAR)',
    body: 'Icom’s digital voice system. It sounds clean until the signal gets weak, then drops out. You only hear other D-STAR stations, and your call sign must be programmed into the radio first.',
  },
  'mode-USB': {
    title: 'USB, upper sideband',
    body: 'A voice mode for long-distance and weak-signal contacts. It reaches farther than FM, but voices sound garbled until you are tuned to within a few hertz. On these bands, sideband voice is always USB.',
  },
  'mode-LSB': {
    title: 'LSB, lower sideband',
    body: 'The mirror image of USB. Rarely used on these bands, except for some satellite contacts.',
  },
  'mode-CW': {
    title: 'CW, Morse code',
    body: 'A tone switched on and off. It gets through when voice cannot. To send, you need a Morse key plugged into the radio.',
  },
  'mode-AM': {
    title: 'AM',
    body: 'The original voice mode. Seldom used on these bands today.',
  },
  moreModes: {
    title: 'More modes',
    body: 'RTTY is radio teletype. CW-R and RTTY-R are the same modes received from the other side of the signal. DD is D-STAR high-speed data, on 23 cm only.',
  },

  // --- Repeater ---
  shift: {
    title: 'Repeater shift',
    body: 'A repeater is a relay station on a hill or tower. It listens on one frequency and re-transmits you on another. Shift makes your radio transmit a set distance below (−) or above (+) the frequency you listen on. Off means you transmit where you listen.',
  },
  offset: {
    title: 'Shift distance',
    body: 'How far apart the repeater’s two frequencies are. It is usually 600 kHz on 2 meters and 5 MHz on 70 centimeters.',
  },
  usual: {
    title: 'Use the usual settings',
    body: 'Sets the shift direction and distance that most repeaters in this part of the band use. It varies by region, and you still need the repeater’s tone.',
  },
  tone: {
    title: 'Access tone',
    body: 'Most repeaters ignore you unless your signal carries a low hum, too deep to notice, called a CTCSS or PL tone. “Send” adds the tone when you transmit. “Send and require” also keeps your speaker quiet unless the other station sends it.',
  },
  toneFreq: {
    title: 'Tone frequency',
    body: 'Every repeater publishes its tone, such as 88.5 or 100.0 Hz, along with its frequency and shift. Look yours up in a repeater directory such as RepeaterBook.',
  },
  txLine: {
    title: 'Where you will transmit',
    body: 'With a shift set, you listen on the frequency shown at the top but transmit on this one. Check it matches the repeater’s published input frequency.',
  },

  // --- Favorites ---
  favorites: {
    title: 'Favorites',
    body: 'Frequencies you have saved, each with its mode and repeater settings. Click one to go straight there. They are stored in this browser, not in the radio.',
  },
  saveFavorite: {
    title: 'Save this frequency',
    body: 'Keeps the current frequency, mode, shift and tone under a name you choose.',
  },
  calling: {
    title: 'Calling frequency',
    body: 'A meeting place everyone knows. Make contact here, then agree on another frequency and move there to chat, so the calling frequency stays free.',
  },

  // --- Listen ---
  listen: {
    title: 'Listen',
    body: 'Plays the radio’s sound through this computer. Browsers only allow a page to make sound after you click, which is why it starts switched off.',
  },
  volume: {
    title: 'Volume',
    body: 'Loudness on this computer only. It does not move the volume knob on the radio.',
  },
  squelch: {
    title: 'Squelch',
    body: 'Silences the hiss when nobody is transmitting. Raise it until the hiss just stops. Set too high, it will also cut off weak stations.',
  },
  signal: {
    title: 'Signal strength',
    body: 'How strongly you are receiving, in S-units from S1 (barely there) to S9 (strong). Above S9 it is given in decibels over, such as S9+20.',
  },
  preamp: {
    title: 'Preamp',
    body: 'Boosts incoming signals before the receiver. It helps with faint stations. Turn it off if strong nearby signals start causing noise.',
  },
  nr: {
    title: 'Noise reduction',
    body: 'Digitally softens steady background hiss so voices stand out. Most useful on sideband and Morse.',
  },

  // --- Talk ---
  micSetup: {
    title: 'Set up microphone',
    body: 'Lets this page use this device’s microphone. Your browser will ask for permission. Nothing goes on the air until you hold the talk button.',
  },
  ptt: {
    title: 'Hold to talk',
    body: 'Press and hold, wait half a second, speak, then let go to listen. Nobody else can be heard while you hold it. You need an amateur radio license to transmit, and you must give your call sign at the end of a contact and at least every 10 minutes.',
  },
  micLevel: {
    title: 'Microphone level',
    body: 'Moves when the microphone picks up your voice. If it stays flat while you speak, check which microphone your browser is using.',
  },
  power: {
    title: 'Transmit power',
    body: 'Use the least power that gets you through. A nearby repeater needs very little. Full power is 100 watts on 2 meters, 75 on 70 centimeters and 10 on 23 centimeters.',
  },
  txPower: {
    title: 'Output power',
    body: 'The watts actually leaving the radio for the antenna while you transmit.',
  },
  swr: {
    title: 'SWR, antenna match',
    body: 'Shows how well your antenna suits the frequency. Under 1.5 is good. Over 2, stop and check the antenna and cable: a bad match wastes power and can damage the radio.',
  },
};

// ---------------------------------------------------------------------------

const SHOW_DELAY_MS = 350;
const STORAGE_KEY = 'console.tips';

// explain: on touch screens, a button that makes the next taps explain
// controls instead of pressing them.
export function setupTips({ toggle, explain }) {
  const box = document.getElementById('tooltip');
  const titleEl = box.querySelector('.tooltip-title');
  const bodyEl = box.querySelector('.tooltip-body');
  let enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
  let timer = null;
  let current = null;

  toggle.checked = enabled;
  document.body.classList.toggle('tips-off', !enabled);
  toggle.addEventListener('change', () => {
    enabled = toggle.checked;
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    document.body.classList.toggle('tips-off', !enabled);
    if (!enabled) hide();
  });

  function contentFor(el) {
    if (el.dataset.tipTitle || el.dataset.tipBody) {
      return { title: el.dataset.tipTitle || '', body: el.dataset.tipBody || '' };
    }
    return TIPS[el.dataset.tip] || null;
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    // Prefer below the control; go above when there is no room.
    let top = r.bottom + gap;
    let above = false;
    if (top + b.height > window.innerHeight - margin) {
      top = r.top - gap - b.height;
      above = true;
    }
    if (top < margin) {
      top = margin;
    }
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - b.width - margin));
    box.style.top = `${Math.round(top)}px`;
    box.style.left = `${Math.round(left)}px`;
    box.dataset.side = above ? 'above' : 'below';
  }

  function show(el, always = false) {
    const content = contentFor(el);
    if (!content || !(enabled || always)) return;
    current = el;
    titleEl.textContent = content.title;
    bodyEl.textContent = content.body;
    box.hidden = false;
    place(el);
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    current = null;
    box.hidden = true;
  }

  function schedule(el, delay) {
    clearTimeout(timer);
    if (current === el) return;
    timer = setTimeout(() => show(el), delay);
  }

  const tipTarget = (node) => (node instanceof Element ? node.closest('[data-tip], [data-tip-title]') : null);

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = tipTarget(e.target);
    if (el) schedule(el, current ? 80 : SHOW_DELAY_MS);
    else hide();
  });
  document.addEventListener('pointerdown', hide);
  document.addEventListener('focusin', (e) => {
    const el = tipTarget(e.target);
    // Only for keyboard focus: a mouse click already had its hover tip.
    if (el && e.target.matches(':focus-visible')) schedule(el, 0);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  // A touch screen has no hover, so there "What does this do?" is a mode:
  // while it is on, a tap shows the tip and the control is not pressed.
  let explaining = false;
  function setExplaining(on) {
    explaining = on;
    document.body.classList.toggle('explaining', on);
    if (explain) explain.setAttribute('aria-pressed', String(on));
    if (explain) explain.textContent = on ? 'Tap anything outlined. Tap here when done' : 'What does this do?';
    if (!on) hide();
  }
  if (explain) explain.addEventListener('click', () => setExplaining(!explaining));
  const intercept = (e) => {
    if (!explaining || (explain && explain.contains(e.target))) return;
    // Nothing underneath may react: this is how the talk button stays unpressed.
    e.stopImmediatePropagation();
    // Keep sliders from moving and menus from opening under the finger.
    if (e.type === 'pointerdown' || e.type === 'mousedown') e.preventDefault();
    if (e.type !== 'click') return;
    e.preventDefault();
    const el = tipTarget(e.target);
    if (el) show(el, true);
    else hide();
  };
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'change', 'input']) {
    document.addEventListener(type, intercept, true);
  }

  return { hide };
}
