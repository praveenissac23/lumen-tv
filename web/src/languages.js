// Language detection from category and title names, used for home sections and filters.
import { C, setLangHook } from './data.js';
import { S } from './store.js';

export const LANGS = [
  { id: 'malayalam', name: 'Malayalam', iso: 'ml', keys: ['malayalam', 'mal ', 'mlm', 'kerala', 'mollywood', 'ml |', 'ml:'] },
  { id: 'tamil', name: 'Tamil', iso: 'ta', keys: ['tamil', 'kollywood', 'tam ', 'ta |', 'ta:'] },
  { id: 'hindi', name: 'Hindi', iso: 'hi', keys: ['hindi', 'bollywood', 'hin ', 'hi |', 'hi:'] },
  { id: 'telugu', name: 'Telugu', iso: 'te', keys: ['telugu', 'tollywood', 'tel ', 'te |', 'te:'] },
  { id: 'kannada', name: 'Kannada', iso: 'kn', keys: ['kannada', 'sandalwood', 'kan ', 'kn |'] },
  { id: 'english', name: 'English', iso: 'en', keys: ['english', 'hollywood', 'eng ', 'uk |', 'us |', 'uk:', 'us:', 'en |'] },
  { id: 'arabic', name: 'Arabic', iso: 'ar', keys: ['arabic', 'arab', 'ar |', 'ar:', 'عربي'] },
  { id: 'bengali', name: 'Bengali', iso: 'bn', keys: ['bengali', 'bangla', 'bn |'] },
  { id: 'punjabi', name: 'Punjabi', iso: 'pa', keys: ['punjabi', 'pb |'] },
  { id: 'marathi', name: 'Marathi', iso: 'mr', keys: ['marathi'] },
  { id: 'urdu', name: 'Urdu', iso: 'ur', keys: ['urdu', 'pakistan', 'pk |'] },
  { id: 'filipino', name: 'Filipino', iso: 'tl', keys: ['filipino', 'pinoy', 'tagalog', 'ph |'] },
];
export const langById = (id) => LANGS.find((l) => l.id === id);

const cache = new Map();
function matches(text, lang) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  return lang.keys.some((k) => t.includes(k));
}

// Category ids of `kind` that belong to a language (cached per catalogue load).
export function langCats(kind, id) {
  const key = kind + ':' + id + ':' + C.updatedAt + ':' + C.cats[kind].length;
  if (cache.has(key)) return cache.get(key);
  const lang = langById(id);
  const set = new Set(lang ? C.cats[kind].filter((c) => matches(c.raw || c.name, lang)).map((c) => c.id) : []);
  cache.set(key, set);
  return set;
}

// Items of a language: in a matching category, or tagged in the title ("ML: ..." / "[Tamil]").
export function langItems(kind, id) {
  const lang = langById(id);
  if (!lang) return [];
  const cats = langCats(kind, id);
  return C[kind].filter((it) => cats.has(it.cat) || (it.tag && matches(it.tag, lang)));
}

// Languages present in the catalogue with counts, for settings.
export function langStats() {
  return LANGS.map((l) => ({
    ...l,
    live: langItems('live', l.id).length,
    movie: langItems('movie', l.id).length,
    series: langItems('series', l.id).length,
  }));
}

export function newest(list, n = 50) {
  return [...list].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, n);
}

setLangHook(langItems);

// "Malayalam (all)" style entries for category lists, for the viewer's languages that exist here.
export function langCatEntries(kind) {
  return S.myLangs.map((id) => {
    const l = langById(id);
    const n = l ? langItems(kind, id).length : 0;
    return n ? { id: '__lang:' + id, name: `All ${l.name}`, icon: 'globe', count: n } : null;
  }).filter(Boolean);
}
