import axios from 'axios';

const RIOT_API_KEY = 'RGAPI-8c6cdaf6-4efd-4c43-ba80-1a2292846b80'; // Replace with your new API key
const REGION = 'euw1';
const MATCH_REGION = 'europe';
const summonerName = 'BullDOSER#2025';

const headers = {
  'X-Riot-Token': RIOT_API_KEY,
};

let lastMatchId: string | null = null;

async function getSummonerData(name: string) {
  try {
    const res = await axios.get(
      `https://${REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(name)}`,
      { headers }
    );
    return res.data;
  } catch (err: any) {
    console.error('Error fetching summoner data:', err.response?.data || err.message);
    throw err;
  }
}

async function getLastMatchId(puuid: string) {
  try {
    const res = await axios.get(
      `https://${MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`,
      { headers }
    );
    return res.data[0];
  } catch (err: any) {
    console.error('Error fetching last match ID:', err.response?.data || err.message);
    throw err;
  }
}

async function getMatchResult(matchId: string, puuid: string) {
  try {
    const res = await axios.get(
      `https://${MATCH_REGION}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      { headers }
    );
    const player = res.data.info.participants.find((p: any) => p.puuid === puuid);
    return player?.win ? 'Victory' : 'Defeat';
  } catch (err: any) {
    console.error('Error fetching match result:', err.response?.data || err.message);
    throw err;
  }
}

export async function checkMatchStatus() {
  try {
    console.log("Checking match status...");
    const summoner = await getSummonerData(summonerName);
    const puuid = summoner.puuid;
    const matchId = await getLastMatchId(puuid);

    if (matchId !== lastMatchId) {
      lastMatchId = matchId;
      const result = await getMatchResult(matchId, puuid);
      console.log(`New match ended: ${result}`);
      return { matchId, result };
    } else {
      console.log('No new match');
      return null;
    }
  } catch (err: any) {
    console.error('Error checking match:', err.response?.data || err.message);
    return null;
  }
}