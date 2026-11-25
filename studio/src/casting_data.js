'use strict';
// Who each character in the library is: the 20 profiles of the Indian character library (plus any extra you add).
// Used by src/casting.js to give every person in a story a trained Ghibli character that fits (gender, age, look),
// so the old flat figure is never drawn. A profile only matters once a character with the same id has been trained
// in the Learning Studio (characters/<id>/learned); until then it is skipped.
//
//   id:     the folder name in characters/ (lowercase, no spaces)
//   gender: 'm' or 'f'          age: years (the story uses it to pick child / adult / elder)
//   tags:   what you can SEE on the drawing. A cast line such as "Ramu (man, turban, glasses)" is matched to these.
//           words understood: turban cap bun glasses beard moustache saree kurta school uniform dress
//   alias:  other spellings of the name that should pick this character ("Zoya" -> zoya_toddler)
//   note:   region and role, for people only
module.exports = {
  aarohi:       { name: 'Aarohi',       gender: 'f', age: 0.7, tags: ['dress'], note: 'Gond, central India; baby girl' },
  ved:          { name: 'Ved',          gender: 'm', age: 2,   tags: [], note: 'Marathi, Maharashtra; toddler boy' },
  zoya_toddler: { name: 'Zoya',         gender: 'f', age: 4,   tags: ['cap'], alias: ['zoya'], note: 'Kashmiri; toddler girl in a pheran' },
  mangal:       { name: 'Mangal',       gender: 'm', age: 7,   tags: ['school'], note: 'Gond, Chhattisgarh; village schoolboy' },
  simran:       { name: 'Simran',       gender: 'f', age: 9,   tags: ['dress'], note: 'Punjabi; schoolgirl in salwar-kameez' },
  kavin:        { name: 'Kavin',        gender: 'm', age: 11,  tags: ['school', 'uniform'], note: 'Tamil, Tamil Nadu; schoolboy' },
  laraphi:      { name: 'Laraphi',      gender: 'f', age: 12,  tags: ['school', 'uniform'], alias: ['iaraphi'], note: 'Khasi, Meghalaya; schoolgirl' },
  ritwik:       { name: 'Ritwik',       gender: 'm', age: 15,  tags: ['glasses'], note: 'Bengali; student' },
  kavya:        { name: 'Kavya',        gender: 'f', age: 17,  tags: ['dress'], note: 'Rajasthani; teenage girl in ghagra' },
  krish:        { name: 'Krish',        gender: 'm', age: 19,  tags: [], note: 'Gujarati, Ahmedabad; urban teenager' },
  phulo:        { name: 'Phulo',        gender: 'f', age: 24,  tags: ['saree'], note: 'Santhal, Jharkhand; farmer' },
  arjun:        { name: 'Arjun',        gender: 'm', age: 27,  tags: ['glasses'], note: 'Telugu, Hyderabad; software engineer' },
  madhura:      { name: 'Madhura',      gender: 'f', age: 30,  tags: ['saree', 'glasses', 'bun'], note: 'Marathi; government schoolteacher' },
  chandan:      { name: 'Chandan',      gender: 'm', age: 32,  tags: ['moustache'], note: 'Bihari, Patna; street-food vendor' },
  navpreet:     { name: 'Navpreet',     gender: 'f', age: 35,  tags: [], note: 'Punjabi, Delhi; entrepreneur' },
  vikram:       { name: 'Vikram',       gender: 'm', age: 41,  tags: ['moustache'], note: 'Dogra, Jammu; army veteran' },
  manjeet_kaka: { name: 'Manjeet Kaka', gender: 'm', age: 45,  tags: ['turban', 'beard', 'kurta'], alias: ['manjeet', 'kaka'], note: 'Sikh uncle (age assumed: no profile yet)' },
  sabitri:      { name: 'Sabitri',      gender: 'f', age: 46,  tags: ['saree'], note: 'Odia, Odisha; rural artisan' },
  mahesh:       { name: 'Mahesh',       gender: 'm', age: 49,  tags: ['moustache', 'glasses', 'kurta'], note: 'Marwari, Rajasthan; business owner' },
  janki:        { name: 'Janki',        gender: 'f', age: 63,  tags: ['saree', 'bun'], note: 'Gond, Chhattisgarh; village grandmother' },
  narayanan:    { name: 'Narayanan',    gender: 'm', age: 68,  tags: ['glasses', 'beard', 'moustache'], note: 'Malayali, Kerala; retired professor' },
};
