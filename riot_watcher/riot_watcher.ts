import axios from 'axios';
import { error } from 'console';
import dotenv from 'dotenv';

dotenv.config();

const RIOT_API_KEY = process.env.RIOT_API_KEY;

const headers = {
  'X-Riot-Token': RIOT_API_KEY,
};

export async function fetchAndStorePuuid(name: string, tagline: string) {
  try {
    const url = "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/" + name + "/" + tagline;
    const response = await axios.get(url, { headers });
    const puuid = response.data.puuid;

    try {
      const surl = "https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/" + puuid;
      const rep = await axios.get(surl, { headers });
      const suuid = rep.data.id;
      const level = rep.data.summonerLevel;
      const icon = rep.data.profileIconId;

      return {puuid, suuid, level, icon};
    } catch (error) {
      console.error('Error fetching or storing SUUID:', error);
      throw error;
    }

  } catch (error) {
    console.error('Error fetching or storing PUUID:', error);
    throw error;
  }

}

export async function getMatchesStats(puuid: string) {
  try {
    const url = "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/" + puuid + "/ids?type=ranked&start=0&count=20";
    const response = await axios.get(url, { headers });
    const matchIds: string[] = response.data;

    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let totalCS = 0;
    let totalMinutes = 0;
    let wins = 0;
    let gamesAnalyzed = 0;

    for (const matchId of matchIds) {
      const matchUrl = `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`;
      const matchRes = await axios.get(matchUrl, { headers });
      const matchData = matchRes.data;

      const participant = matchData.info.participants.find((p: any) => p.puuid === puuid);
      if (!participant) continue;

      totalKills += participant.kills;
      totalDeaths += participant.deaths;
      totalAssists += participant.assists;
      totalCS += participant.totalMinionsKilled + participant.neutralMinionsKilled;
      totalMinutes += matchData.info.gameDuration / 60;
      if (participant.win) wins += 1;
      gamesAnalyzed += 1;
    }

    const avgKDA = gamesAnalyzed > 0 ? (totalKills + totalAssists) / Math.max(1, totalDeaths) : 0;
    const avgCSPerMin = totalMinutes > 0 ? totalCS / totalMinutes : 0;
    const winrate = gamesAnalyzed > 0 ? (wins / gamesAnalyzed) * 100 : 0;

    return {
      avgKDA,
      avgCSPerMin,
      winrate,
      gamesAnalyzed
    };

  } catch (error) {
    console.error('Error fetching or calculating match stats:', error);
    throw error;
  }
}

export async function fetchCurrentMatch(puuid: string) {
  try {
    const url = "https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/" + puuid;
    const response = await axios.get(url, { headers });
    if(response.data.gameQueueConfigId === "420") {
      for (let player of response.data.participants) {
        if (player.puuid === puuid) {
          return {
            champion: player.championId,
            time: response.data.gameStartTime
          };
        }
      }
      return {error: "Player not found in the current match"};
    }

  } catch (error) {
    console.error('Error fetching current match:', error);
    throw error;
  }

}

export async function getRankedStats(puuid: string) {
  try {
    const url = "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/" + puuid;
    const response = await axios.get(url, { headers });
    const rankedData = response.data[0];

    if (!rankedData) {
      throw new Error('Ranked data not found');
    }

    let winrate = rankedData.wins + rankedData.losses > 0 ? (rankedData.wins / (rankedData.wins + rankedData.losses)) * 100 : 0;

    return {
      tier: rankedData.tier,
      rank: rankedData.rank,
      leaguePoints: rankedData.leaguePoints,
      wins: rankedData.wins,
      losses: rankedData.losses,
      winrate: winrate.toFixed(2),
    };

  } catch (error) {
    console.error('Error fetching or calculating match stats:', error);
    throw error;
  }
}