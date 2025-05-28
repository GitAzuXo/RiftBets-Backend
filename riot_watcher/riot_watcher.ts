import axios from 'axios';
import dotenv from 'dotenv';
import { db } from '../index';


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

    const rankedurl = "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/" + puuid;
    const responseranked = await axios.get(rankedurl, { headers });
    const rankedData = responseranked.data.find((entry: any) => entry.queueType === "RANKED_SOLO_5x5");

    await db.riot_data.updateMany({
      where: { rd_puuid: puuid },
      data: {
      rd_kda: avgKDA,
      rd_csm: avgCSPerMin,
      rd_winrate: winrate,
      rd_elo: rankedData ? rankedData.tier : "UNRANKED",
      rd_div: rankedData ? rankedData.rank : null
      }
    });

    return;

  } catch (error) {
    console.error('Error fetching or calculating match stats:', error);
    throw error;
  }
}

export async function fetchCurrentMatch(puuid: string) {
  try {
    const url = "https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/" + puuid;
    const response = await axios.get(url, { headers });
    if (response.data.gameQueueConfigId === 420) {
      console.log("Player is in a ranked match");
      for (let player of response.data.participants) {
        if (player.puuid === puuid) {
          return {
            champion: player.championId,
            time: response.data.gameStartTime,
            id: response.data.gameId,
            team: player.teamId
          };
        }
      }
      return { error: "Player not found in the current match" };
    }
    return { error: "Currently not in a ranked solo/duo match" };
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      return { error: "Currently not in a match" };
    }
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

export async function autoFinishProposals() {
  // Get all proposals that are not finished
  const options = await db.bet_option.findMany({
    where: { bo_state: { not: 'FINISHED' } },
    select: {
      bo_id: true,
      bo_game: true,
      bo_state: true,
      bo_title: true
    }
  });

  for (const option of options) {
    if (option.bo_title !== "Parier sur l'issue de la partie") continue;

    // Get all users in the game from useringame table
    const usersInGame = await db.user_in_match.findMany({
      where: { game_id: option.bo_game },
      select: { user_name: true }
    });
    if (!usersInGame || usersInGame.length === 0) continue;

    // For each user in the game
    for (const userInGame of usersInGame) {
      // Get puuid from riotdata
      const riotData = await db.riot_data.findFirst({
        where: { rd_user: userInGame.user_name },
        select: { rd_puuid: true }
      });
      if (!riotData) continue;
      const puuid = riotData.rd_puuid;

      // Check if player is still in the match
      const currentGame = await fetchCurrentMatch(puuid);
      if (currentGame && currentGame.id == option.bo_game) {
        continue;
      }

      try {
        const matchid = "EUW1_" + option.bo_game;
        const matchUrl = `https://europe.api.riotgames.com/lol/match/v5/matches/${matchid}`;
        const matchRes = await axios.get(matchUrl, { headers });
        const matchData = matchRes.data;
        const participant = matchData.info.participants.find((p: any) => p.puuid === puuid);
        if (!participant) continue;
        const win = participant.win;
        let result = 1;
        if (!win) result = 0;

        await db.game.update({
          where: { game_id: option.bo_game },
          data: { game_result: result, game_state: 'FINISHED' }
        });

        const bets = await db.bet.findMany({
          where: { bet_bo: option.bo_id, bet_user: userInGame.user_name }
        });

        for (const bet of bets) {
          if (bet.bet_side === result) {
            const payout = Number(bet.bet_amount) * Number(bet.bet_odd);
            await db.user.update({
              where: { user_name: bet.bet_user },
              data: { user_balance: { increment: payout } }
            });
            await db.bet.updateMany({
              where: { bet_bo: option.bo_id, bet_user: bet.bet_user },
              data: { bet_state: 'WON' }
            });
          } else {
            await db.bet.updateMany({
              where: { bet_bo: option.bo_id, bet_user: bet.bet_user },
              data: { bet_state: 'LOST' }
            });
          }
        }

        // Mark proposal as finished for this user
        await db.bet_option.update({
          where: { bo_id: option.bo_id },
          data: { bo_state: 'FINISHED' }
        });

        // Give 1 coin to the user
        await db.user.update({
          where: { user_name: userInGame.user_name },
          data: { user_balance: { increment: 1 } }
        });

        console.log(`Proposal ${option.bo_id} for user ${userInGame.user_name} finished with result: ${win ? 'WIN' : 'LOSE'}`);
      } catch (err) {
        console.error("Error fetching match data:", err);
      }
    }
  }
}
