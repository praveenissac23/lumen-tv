// Built-in demo catalogue so the app is browsable before a playlist is added.
// All names are invented.
import { hash } from './util.js';

const LIVE = {
  News: ['Meridian News', 'Gulf 24', 'World Report', 'Capital Business', 'Desert Times TV', 'Global Wire', 'Metro News 1', 'Market Watch Live', 'Harbour News', 'First Light News'],
  Sports: ['Atlas Sports 1', 'Atlas Sports 2', 'Atlas Sports 3', 'Atlas Sports 4', 'Courtside', 'Pitch One', 'Fairway Golf', 'Cricket Central', 'Racing Line', 'Fight Night TV', 'Arena Live', 'Tennis Club'],
  Entertainment: ['Starlight', 'Velvet', 'Prime Comedy', 'City Life', 'Encore', 'Lantern TV', 'Bluebird', 'Showcase One', 'Reality Plus', 'Cascade'],
  Movies: ['Cinema One', 'Cinema Action', 'Cinema Premiere', 'Classic Reels', 'Thriller Zone', 'Family Movies', 'Silver Screen', 'Indie Cuts', 'Box Office Hits', 'Midnight Movies'],
  Kids: ['Little Stars', 'Toon Town', 'Junior Planet', 'Puzzle Box', 'Wonder Kids', 'Bedtime TV'],
  Documentary: ['Wild Earth', 'Deep Blue', 'History Vault', 'Science Lab', 'Explorer', 'Engineering Marvels', 'Food Trails'],
  Music: ['Pulse Music', 'Retro Hits', 'Desi Beats', 'Arabic Classics', 'Chill Lounge'],
  Arabic: ['Al Waha', 'Noor TV', 'Sahara Drama', 'Al Bahr', 'Qamar', 'Majlis TV', 'Riyadh Plus', 'Doha Life'],
  'Malayalam': ['Kerala Vision', 'Malayalam Movies', 'Kochi Live', 'Periyar News', 'Onam TV', 'Kayal Music'],
  'Tamil': ['Tamil Express', 'Chennai Live', 'Kaveri TV', 'Tamil Cinema Plus', 'Madurai News'],
  'Hindi': ['Bollywood Gold', 'Hindi Drama', 'Desi News', 'Cricket Hindi', 'Filmi Plus', 'Rang TV'],
  'Late night (18+)': ['After Hours 1', 'After Hours 2'],
};

const SHOWS = {
  News: ['Morning Briefing', 'World Today', 'Business Hour', 'The Debate', 'Headlines', 'Market Close', 'Evening Edition', 'Weather Watch', 'Tech Now', 'Week in Review'],
  Sports: ['Premier Football: Harbour City v Northvale', 'Champions Night Live', 'Grand Prix Qualifying', 'Cricket: Desert Kings v Coastal Riders', 'Tennis Masters Final', 'Golf Tour Round 3', 'Fight Night Main Card', 'Football Highlights', 'Sports Centre', 'Basketball Showdown'],
  Entertainment: ['The Family Next Door', 'Late Show', 'Kitchen Wars', 'Island Escape', 'Comedy Hour', 'Talent Search', 'Dream Homes', 'Quiz Night', 'Celebrity Chef', 'Weekend Live'],
  Movies: ['The Glass Harbour', 'Night Run', 'Iron Valley', 'The Silent Coast', 'Northern Lights', 'Red Dune', 'The Last Garden', 'Paper Planes', 'Edge of Tomorrow Bay', 'Crosswind'],
  Kids: ['Robo Pals', 'Ocean Friends', 'Draw with Max', 'Space Cadets', 'The Tiny Farm', 'Bedtime Stories', 'Puzzle Quest', 'Animal Alphabet'],
  Documentary: ['Planet Oceans', 'Desert Kingdoms', 'Megastructures', 'Ancient Cities', 'Inside the Machine', 'Wild Africa', 'Street Food Asia', 'The Silk Road'],
  Music: ['Top 40 Countdown', 'Retro Rewind', 'Live Sessions', 'Unplugged', 'Desi Top 20', 'Lounge Mix'],
  Arabic: ['Bab Al Hara Nights', 'Sahara Stories', 'Majlis Talk', 'Al Waha Drama', 'Coffee & News', 'Desert Poets', 'Family Majlis'],
  Malayalam: ['Kerala Kitchen', 'Malayalam Superhits', 'Kochi Tonight', 'Comedy Utsavam', 'Vartha Raathri', 'Paattu Vedi'],
  Tamil: ['Tamil Talkies', 'Chennai Express News', 'Super Singer Night', 'Kollywood Hits', 'Kaveri Kathai'],
  Hindi: ['Cricket Live: Hindi', 'Bollywood Classics', 'Prime Time Hindi', 'Antakshari Night', 'Rang Mahal'],
  'Late night (18+)': ['Late programme'],
};

const FILMS = [
  ['The Glass Harbour', 2025, 'Drama'], ['Night Run', 2024, 'Action'], ['Iron Valley', 2023, 'Western'], ['The Silent Coast', 2025, 'Thriller'],
  ['Northern Lights', 2022, 'Romance'], ['Red Dune', 2026, 'Sci-fi'], ['The Last Garden', 2021, 'Drama'], ['Paper Planes', 2024, 'Family'],
  ['Crosswind', 2025, 'Action'], ['Salt and Stone', 2023, 'Drama'], ['Midnight Express Line', 2026, 'Thriller'], ['A Year in Kyoto', 2022, 'Romance'],
  ['The Cartographer', 2024, 'Adventure'], ['Signal Lost', 2025, 'Sci-fi'], ['Copper Moon', 2021, 'Mystery'], ['The Orchard', 2023, 'Drama'],
  ['Falcon Ridge', 2026, 'Action'], ['Beneath the Dunes', 2024, 'Adventure'], ['Small Hours', 2022, 'Comedy'], ['Brass Monkey', 2025, 'Comedy'],
  ['The Lighthouse Keeper', 2023, 'Mystery'], ['Second Spring', 2021, 'Romance'], ['Overdrive', 2026, 'Action'], ['The Heist at Marina Bay', 2025, 'Thriller'],
  ['Wolf Season', 2024, 'Thriller'], ['Golden Hour', 2022, 'Drama'], ['Kite Runner Road', 2023, 'Family'], ['Echoes', 2025, 'Horror'],
  ['The Long Weekend', 2024, 'Comedy'], ['Monsoon Wedding Party', 2026, 'Comedy'], ['Velocity', 2025, 'Action'], ['The Archivist', 2023, 'Mystery'],
  ['Star Ferry', 2022, 'Romance'], ['Hollow Point', 2024, 'Action'], ['Tidal', 2026, 'Sci-fi'], ['The Pearl Diver', 2025, 'Drama'],
  ['Backwaters', 2024, 'Drama'], ['Kochi Nights', 2025, 'Thriller'], ['Cardamom Hills', 2023, 'Family'], ['The Spice Merchant', 2022, 'Adventure'],
  ['Clockwork Heart', 2026, 'Sci-fi'], ['Fourth Floor', 2024, 'Horror'], ['Open Road', 2021, 'Adventure'], ['After the Rain', 2025, 'Romance'],
  ['The Quiet Partner', 2023, 'Thriller'], ['Neon Souk', 2026, 'Action'], ['Grandmaster', 2024, 'Drama'], ['The Tailor of Deira', 2025, 'Drama'],
  ['Robots Ahoy', 2024, 'Animation'], ['The Snow Fox', 2023, 'Animation'], ['Captain Pickle', 2025, 'Animation'], ['Moon Bakery', 2026, 'Animation'],
];
// Invented titles for the language sections, built from common words.
const LANG_WORDS = {
  Malayalam: [['Kaayal', 'Mazha', 'Ponnu', 'Nila', 'Theeram', 'Kaattu', 'Thira', 'Vazhi', 'Mounam', 'Swapna', 'Neela', 'Velicham'],
    ['Raavu', 'Kadha', 'Yaathra', 'Pookkal', 'Kaalam', 'Ormakal', 'Doore', 'Nagaram', 'Thaalam', 'Veedu', 'Sandhya', 'Kinavu']],
  Tamil: [['Nila', 'Kaatru', 'Vaanam', 'Mazhai', 'Theru', 'Kadal', 'Ooru', 'Pon', 'Megam', 'Thee', 'Kural', 'Vizhi'],
    ['Payanam', 'Kadhai', 'Raja', 'Ninaivu', 'Veedu', 'Iravu', 'Velicham', 'Aattam', 'Kanavu', 'Vettai', 'Paadal', 'Thozhan']],
  Hindi: [['Safar', 'Raat', 'Dil', 'Sapna', 'Rang', 'Aasman', 'Raasta', 'Dhoop', 'Saaya', 'Toofan', 'Khwab', 'Nazar'],
    ['Ki Kahani', 'Express', 'Wale', 'Ke Paar', 'Ka Raaz', 'Nagar', 'Diaries', 'Returns', 'Mission', 'Junction', 'Gali', 'Mahal']],
};
const LANG_GENRES = ['Drama', 'Action', 'Comedy', 'Thriller', 'Romance', 'Family'];
function langFilms() {
  const out = [];
  for (const [lang, [a, b]] of Object.entries(LANG_WORDS)) {
    let n = 0;
    for (let i = 0; i < a.length && n < 64; i++) for (let j = 0; j < b.length && n < 64; j += 2) {
      const k = (i * 5 + j * 7) % b.length;
      out.push([`${a[i]} ${b[k]}`, 2018 + ((i + j) % 9), LANG_GENRES[(i + j) % 6], lang + ' Movies']);
      n++;
    }
  }
  return out;
}

const SERIES = [
  ['Harbour City', 2025, 'Crime'], ['The Majlis', 2024, 'Drama'], ['Skyline', 2026, 'Drama'], ['Dead Reckoning', 2023, 'Thriller'],
  ['Parallel Lines', 2025, 'Sci-fi'], ['The Bakers of Bath Street', 2022, 'Comedy'], ['Frontier', 2024, 'Western'], ['Ward Nine', 2025, 'Medical'],
  ['Silk & Steel', 2026, 'Historical'], ['Kerala Diaries', 2024, 'Drama'], ['The Fixer', 2023, 'Crime'], ['Cold Storage', 2025, 'Thriller'],
  ['Little Robots', 2024, 'Kids'], ['Planet Kitchen', 2023, 'Reality'], ['High Desert', 2026, 'Drama'], ['The Counsel', 2025, 'Legal'],
  ['Night Shift', 2024, 'Comedy'], ['Ascent', 2026, 'Adventure'],
  ['Kaayal Veedu', 2025, 'Malayalam Series'], ['Thira Kadha', 2026, 'Malayalam Series'], ['Nila Ormakal', 2024, 'Malayalam Series'],
  ['Kadal Payanam', 2025, 'Tamil Series'], ['Ooru Kadhai', 2026, 'Tamil Series'], ['Rang Mahal Diaries', 2025, 'Hindi Series'], ['Safar Junction', 2026, 'Hindi Series'],
];
const GENRE_CAT = (g) => (['Animation', 'Family', 'Kids'].includes(g) ? 'Family & kids' : ['Action', 'Thriller', 'Western', 'Horror', 'Crime'].includes(g) ? 'Action & thriller' : ['Comedy'].includes(g) ? 'Comedy' : ['Sci-fi', 'Adventure', 'Mystery'].includes(g) ? 'Sci-fi & adventure' : 'Drama & romance');

export function demoCatalog() {
  const cats = { live: [], movie: [], series: [] };
  const live = [];
  let num = 1;
  Object.entries(LIVE).forEach(([cat, names], ci) => {
    cats.live.push({ id: 'c' + ci, name: cat });
    names.forEach((name) => {
      live.push({ id: 'd' + num, num, name, cat: 'c' + ci, logo: '', epg: 'd' + num, arch: ['News', 'Sports', 'Entertainment', 'Malayalam', 'Tamil', 'Hindi'].includes(cat) ? 3 : 0, _g: cat });
      num++;
    });
  });
  const mcats = new Map(), scats = new Map();
  const all = [...FILMS.map((f) => [...f, 'English Movies']), ...langFilms()];
  // interleave so every language has recent additions
  all.sort((x, y) => ((x[0].length * 7 + x[1]) % 13) - ((y[0].length * 7 + y[1]) % 13));
  const movie = all.map(([name, year, genre, langCat], i) => {
    const c = genre === 'Animation' ? 'Family & kids' : langCat;
    if (!mcats.has(c)) mcats.set(c, { id: 'm' + mcats.size, name: c });
    return { id: 'f' + i, name, year, genre, cat: mcats.get(c).id, img: '', rating: 3 + (hash(name) % 20) / 10, added: 1000 - i, ext: 'mp4', tag: langCat.split(' ')[0].toLowerCase() };
  });
  const series = SERIES.map(([name, year, genre], i) => {
    const c = genre.endsWith(' Series') ? genre : GENRE_CAT(genre);
    if (!scats.has(c)) scats.set(c, { id: 's' + scats.size, name: c });
    return { id: 'sr' + i, name, year, genre, cat: scats.get(c).id, img: '', rating: 3.2 + (hash(name) % 17) / 10, added: 500 - i,
      plot: 'A new season of the series. Your provider supplies the real synopsis.' };
  });
  // The same film in other qualities, as providers often list them (shown when downloading)
  const gh = movie.find((m) => m.name === 'The Glass Harbour');
  if (gh) {
    gh.q = '1080p';
    movie.push({ ...gh, id: 'f900', q: '4K HDR', ext: 'mkv', added: 0 }, { ...gh, id: 'f901', q: '1080p HEVC', ext: 'mkv', added: 0 }, { ...gh, id: 'f902', q: '720p', added: 0 });
  }
  cats.movie = [...mcats.values()];
  cats.series = [...scats.values()];
  return { live, movie, series, cats, info: { status: 'Demo' }, updatedAt: Date.now() };
}

export function demoEpg(live) {
  const epg = {};
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const start = d0.getTime() / 1000 - 3 * 86400;
  const end = start + 6 * 86400;
  for (const ch of live) {
    const titles = SHOWS[ch._g] || SHOWS.Entertainment;
    const list = [];
    let t = start, k = hash(ch.name) % titles.length;
    const lens = ch._g === 'News' ? [1800, 3600] : ch._g === 'Movies' ? [5400, 7200, 6300] : ch._g === 'Sports' ? [3600, 6300, 7200, 1800] : [1800, 3600, 2700];
    while (t < end) {
      const len = lens[(k + Math.floor(t / 3600)) % lens.length];
      const title = titles[k % titles.length];
      list.push([t, t + len, title, DESCS[(k + ch.num) % DESCS.length]]);
      t += len; k += 1 + (ch.num % 3);
    }
    epg['d' + ch.num] = list;
  }
  return epg;
}
const DESCS = [
  'Live coverage with analysis and reaction from the studio.',
  'The latest developments from around the region and the world.',
  'A gripping hour as the story takes an unexpected turn.',
  'Highlights, interviews and the best moments of the week.',
  'An award-winning look behind the scenes.',
  'Families compete for the top prize in tonight’s final.',
];
