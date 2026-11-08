// Solo support comes from the game's rules, never from a guessed game ID.
export const supportsSolo = game => game.players.min === 1 || Boolean(game.bots?.difficulties?.length);
export const supportsTogether = game => game.players.max === null || game.players.max > 1;

export function filterGames(games, {mode = 'all', query = '', language = 'en'} = {}) {
 const search = query.trim().toLocaleLowerCase(language);
 return games.filter(game => {
  if (mode === 'solo' && !supportsSolo(game)) return false;
  if (mode === 'together' && !supportsTogether(game)) return false;
  return [game.title[language] || game.title.en, game.description[language] || game.description.en]
   .some(value => value.toLocaleLowerCase(language).includes(search));
 });
}

export function createdRoomPath(base, room, mode, game) {
 return mode === 'solo'
  ? `${base}/j/${room.id}?view=${game?.singleDeviceView==='controller'?'controller':'combined'}`
  : `${base}/r/${room.id}`;
}

export function soloBots(game) {
 if(game.players.min===1)return [];
 if(!game.bots?.difficulties?.length)throw Error('This game cannot be played alone yet');
 const difficulty=game.bots.difficulties.includes('medium')?'medium':game.bots.difficulties[0];
 return Array.from({length:game.players.min-1},()=>({difficulty}));
}
