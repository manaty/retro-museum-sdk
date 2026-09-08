// One atomic record per origin/device. Repeated final snapshots never apply Elo twice.
export const RATING_KEY='museum-chess-rating-v1';
export function readRating(storage){try{const value=JSON.parse(storage.getItem(RATING_KEY));if(Number.isInteger(value?.elo)&&value.elo>=0&&value.elo<=4000)return value;}catch{}return null;}
export function initialRating(storage,elo){if(!Number.isInteger(elo)||elo<0||elo>4000)throw Error('Elo must be between 0 and 4000');const value={elo,matches:{}};storage.setItem(RATING_KEY,JSON.stringify(value));return value;}
export function syncRating(storage,elo){if(!Number.isInteger(elo)||elo<0||elo>4000)return;const value=readRating(storage)||{matches:{}};storage.setItem(RATING_KEY,JSON.stringify({...value,elo}));}
export function applyRating(storage,state){
 const result=state.party?.community?.ratings?.find(r=>r.id===state.party.you);
 if(!result||!['solved','ended'].includes(state.phase)||!Number.isInteger(result.after)||result.after<0||result.after>4000)return;
 const value=readRating(storage);if(!value||value.matches?.[state.party.id])return;
 const matches={...value.matches,[state.party.id]:true};
 storage.setItem(RATING_KEY,JSON.stringify({elo:result.after,matches}));
}
