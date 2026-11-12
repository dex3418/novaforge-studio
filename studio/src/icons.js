'use strict';
// Small outline icons used as "objects" in videos: picked from the words of a beat,
// drawn big and softly behind the text, or as the main picture of a "spot" scene.
// Every icon is a 24x24 stroke drawing, so it needs no downloads.

const ICONS = {
  rupee: '<path d="M7 5h10M7 9h10M7 5c5 0 7 2 7 4s-2 4-7 4l7 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5L15.5 10"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/><path d="M15 8h4v4"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4.5 2 4.5 4.5"/>',
  rocket: '<path d="M12 3c3.5 2 5 6 4 11l-4 3-4-3c-1-5 .5-9 4-11z"/><circle cx="12" cy="10" r="1.8"/><path d="M8 14l-3 2 1 3 3-2M16 14l3 2-1 3-3-2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  heart: '<path d="M12 20s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.7A4.5 4.5 0 0 1 20 9c0 5.8-8 11-8 11z"/>',
  book: '<path d="M4 5c3-1 5-1 8 1 3-2 5-2 8-1v13c-3-1-5-1-8 1-3-2-5-2-8-1z"/><path d="M12 6v13"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c3 2 9 2 12 0v-4.5M22 9v6"/>',
};

const KEYWORDS = [
  ['rupee', /rupee|₹|salary|\bpay\b|cost|price|fee\b|budget|money|grant|fund|raise|crore|lakh|spend|save/gi],
  ['clock', /\btime\b|deadline|\bdate\b|\bhour|minute|second|latency|\bdays?\b|month|week|schedule|soon|early/gi],
  ['pin', /location|district|\bcity\b|village|\btown\b|address|\bmap\b|bastar|hyderabad|nearby|local|\bsite/gi],
  ['doc', /\bform\b|document|application|certificate|proof|receipt|\bfile\b|report|notice|paperwork|filings?/gi],
  ['phone', /phone|mobile|\bapp\b|\bcall\b|whatsapp|online|website|\blink\b|download|digital|cloud/gi],
  ['shield', /\bsafe|secure|police|security|protect|verified|trust|guard|insurance|safety/gi],
  ['chart', /grow|rise|increase|boost|profit|trend|percent|%|scale|series a|revenue|metrics?/gi],
  ['bulb', /\bidea|\btip\b|learn|tinyml|innovat|smart|insight|takeaway|lesson|\bhack/gi],
  ['users', /\bteam|founders?|people|community|candidates|students|investors?|\bvcs?\b|partner|builders|everyone|friends/gi],
  ['rocket', /launch|\bstart|begin|\bship|\bbuild|prototype|startup|take ?off|go live/gi],
  ['check', /\bdone\b|complete|ready|checklist|confirmed|approved|success/gi],
  ['alert', /warning|careful|mistake|\bavoid|scam|\brisk|danger|never|\bdon.t/gi],
  ['star', /\bbest\b|\btop\b|\bwin\b|award|first|favourite|premium|quality/gi],
  ['bolt', /\bfast|speed|instant|\bedge\b|quick|power|energy|electric|sensor|chip/gi],
  ['heart', /health|\bcare\b|\blove|support|\bhelp|wellness|family/gi],
  ['book', /study|\bbook|exam|syllabus|course|material|\bread|paper|notes|practice/gi],
  ['briefcase', /\bjobs?\b|career|recruit|vacanc|hiring|\bwork\b|employ|office|business|company|police/gi],
  ['mail', /e-?mail|\bmail\b|speed-post|dispatch|courier|india post|\bsend|shipping|logistics|freight/gi],
  ['cap', /degree|college|school|graduate|universit|education|learn|training|skill/gi],
];

function pickIcon(text, min = 1) {
  let best = null;
  let bestN = min - 1;
  for (const [name, re] of KEYWORDS) {
    const n = (String(text).match(re) || []).length;
    if (n > bestN) {
      best = name;
      bestN = n;
    }
  }
  return best;
}

// svg markup; `color` strokes it, `fill` is an optional soft fill, size in px
function iconSvg(name, size, color, fill, stroke) {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill || 'none'}" stroke="${color}" stroke-width="${stroke || 1.6}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

module.exports = { ICONS, ICON_NAMES: Object.keys(ICONS), pickIcon, iconSvg };
