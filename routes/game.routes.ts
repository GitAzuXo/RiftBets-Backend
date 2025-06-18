import { Router } from "express";
import { db } from "../index";
import { Prisma } from "@prisma/client";

const router = Router();

router.get("/ongoing", async (_req, res) => {
  try {
    const ongoingGames = await db.game.findMany({
      where: { game_state: "ONGOING" }
    });

    // For each ongoing game, fetch its users in match and join riot_data where rd_user matches user_name
    const gamesWithUsers = await Promise.all(
      ongoingGames.map(async (game) => {
        const users = await db.user_in_match.findMany({
          where: { game_id: game.game_id },
        });

        // For each user, fetch their riot_data and champion_name
        const serializedUsers = await Promise.all(users.map(async user => {
          const [riotData, champion] = await Promise.all([
            db.riot_data.findUnique({
              where: { rd_id: user.user_account },
              select: {
                rd_tagline: true,
                rd_level: true,
                rd_icon: true,
                rd_winrate: true,
                rd_kda: true,
                rd_csm: true,
                rd_elo: true,
                rd_div: true,
                rd_lp: true
              }
            }),
            db.champion.findUnique({
              where: { champion_id: user.player_champion },
              select: { champion_name: true }
            })
          ]);

          const serializedUser: any = {};
          for (const key in user) {
            const value = (user as any)[key];
            serializedUser[key] = typeof value === "bigint" ? value.toString() : value;
          }
          serializedUser.riot_data = riotData;
          serializedUser.champion_name = champion?.champion_name || null;
          return serializedUser;
        }));

        // Serialize bigint fields in game
        const serializedGame: any = {};
        for (const key in game) {
          const value = (game as any)[key];
          serializedGame[key] = typeof value === "bigint" ? value.toString() : value;
        }

        return {
          ...serializedGame,
          users_in_match: serializedUsers
        };
      })
    );

    res.json(gamesWithUsers);
  } catch (error) {
    console.error("Error fetching ongoing games:", error);
    res.status(500).json({ error: "Failed to fetch ongoing games." });
  }
});

/**
 * Opens a game if not already present, links the player, manages duoq, and creates bet options.
 * @param user_name The player's username
 * @param riotGameId The Riot game ID (should be unique per match)
 * @param teamId The player's team (100 or 200)
 * @param championId The champion played
 * @param gameStart Timestamp of game start (BigInt)
 */

export async function openOrJoinGame(user_name: string, accountId: number, riotGameId: number, teamId: number, championId: number, gameStart: bigint) {
  let game = await db.game.findUnique({
    where: { game_id: riotGameId }
  });

  if (!game) {
    game = await db.game.create({
      data: {
        game_id: riotGameId,
        game_state: "ONGOING",
        game_start: gameStart,
        game_result: 0
      }
    });
    console.log(`Game ${riotGameId} created.`);
  }

  await db.user_in_match.upsert({
    where: {
      user_name_game_id: {
        user_name,
        game_id: riotGameId
      }
    },
    update: {
      player_team: teamId,
      player_champion: championId
    },
    create: {
      user_name,
      game_id: riotGameId,
      player_team: teamId,
      player_champion: championId,
      user_account: accountId
    }
  });

  const teammates = await db.user_in_match.findMany({
    where: {
      game_id: riotGameId,
      player_team: teamId
    }
  });

  if (teammates.length === 2) {
    console.log(`DUOQ detected in game ${riotGameId} for team ${teamId}:`, teammates.map(t => t.user_name));
  }

  let betOption = await db.bet_option.findFirst({
    where: {
      bo_game: riotGameId,
      bo_title: "Remporte la partie"
    }
  });

  if (!betOption) {
    betOption = await db.bet_option.create({
      data: {
        bo_game: riotGameId,
        bo_title: "Remporte la partie",
        bo_state: "OPEN"
      }
    });

    await db.game_odd.create({
      data: {
        game_id: riotGameId,
        odd_bo: betOption.bo_id,
        odd_win: new Prisma.Decimal(2.0),
        odd_lose: new Prisma.Decimal(2.0)
      }
    });
    console.log(`BetOption created for game ${riotGameId}`);
  }
}

export default router;