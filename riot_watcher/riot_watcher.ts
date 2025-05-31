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
      rd_div: rankedData ? rankedData.rank : null,
      rd_lp: rankedData ? rankedData.leaguePoints : null,
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

export async function autoFinishGames() {
  let usersFinished: { user_name: string, puuid: string }[] = [];
  db.game.findMany({
    where: { game_state: "ONGOING" },
    select: { game_id: true }
  }).then(async (games) => {
    for (const game of games) {
      const users = await db.user_in_match.findMany({
        where: { game_id: game.game_id },
        select: { user_name: true }
      });
      for (const user of users) {
        const puuidObj = await db.riot_data.findUnique({
          where: { rd_user: user.user_name },
          select: { rd_puuid: true }
        });
        if (puuidObj != null && puuidObj.rd_puuid) {
          const matchData = await fetchCurrentMatch(puuidObj.rd_puuid);
          if (matchData.error) {
            console.log(`Game ${game.game_id} finished for user ${user.user_name}`);
            usersFinished.push({ user_name: user.user_name, puuid: puuidObj.rd_puuid });
          } else {
            console.log(`Game ${game.game_id} is still ongoing for user ${user.user_name}`);
          }
        }
      }
      if (usersFinished.length > 0) {
        await db.game.update({
          where: { game_id: game.game_id },
          data: { game_state: "FINISHED" }
        });
        console.log(`Game ${game.game_id} marked as finished.`);
        setTimeout(() => fetchResultMatch(game.game_id, usersFinished), 10000);
        usersFinished = [];
      }
    }
  });
}

async function fetchResultMatch(gameId: bigint, users: { user_name: string, puuid: string }[]){
  try {
    const newId = "EUW1_" + gameId.toString();
    const url = `https://europe.api.riotgames.com/lol/match/v5/matches/${newId}`;
    const response = await axios.get(url, { headers });
    const matchData = response.data;

    let winningTeam: number = 0;
    if (users.length === 0) {
      console.error('No users provided to fetchResultMatch');
      return;
    }
    for (const participant of matchData.info.participants) {
      if (participant.puuid === users[0].puuid) {
        winningTeam = participant.win ? participant.teamId : (participant.teamId === 100 ? 200 : 100);
      }
    }
    await db.game.update({
      where: { game_id: gameId },
      data: { game_result: winningTeam }
    });
    const bos = await db.bet_option.findFirst({
      where: { bo_game: gameId, bo_title: "Remporte la partie" },
      select: { bo_id: true }
    });
    if (bos?.bo_id) {
      await db.bet_option.update({
        where: { bo_id: bos.bo_id },
        data: { bo_state: "FINISHED" }
      });
    }
    const bets = await db.bet.findMany({
      where: { bet_bo: bos?.bo_id },
      select: { bet_user: true, bet_amount: true, bet_odd: true, bet_side: true, bet_id: true }
    });
    for (const bet of bets) {
      if (bet.bet_side === winningTeam) {
        const betAmount = Number(bet.bet_amount);
        const betOdd = Number(bet.bet_odd);
        await db.user.update({
          where: { user_name: bet.bet_user },
          data: { user_balance: { increment: betAmount * betOdd } }
        });
        await db.bet.update({
          where: { bet_id: bet.bet_id },
          data: { bet_state: "WON" }
        });
      } else {
        await db.bet.update({
          where: { bet_id: bet.bet_id },
          data: { bet_state: "LOST" }
        });
      }
    }
  } catch (error) {
    console.error('Error fetching match result:', error);
    throw error;
  }
}
