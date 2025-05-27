import { Router } from "express";
import { db } from "../index";
import { Prisma } from "@prisma/client";

const router = Router();

router.get("/available", async (req, res) => {
    try {
        const games = await db.game.findMany({
            where: { game_state: "ONGOING" }
        });
        res.status(200).json({ games });
    } catch (err: any) {
        res.status(500).json({ message: "Database error", error: err.message });
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

export async function openOrJoinGame(user_name: string, riotGameId: number, teamId: number, championId: number, gameStart: bigint) {
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

  await db.userInMatch.upsert({
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
      player_champion: championId
    }
  });

  // 4. Check how many users are in this game and on the same team
  const teammates = await db.userInMatch.findMany({
    where: {
      game_id: riotGameId,
      player_team: teamId
    }
  });

  if (teammates.length === 2) {
    console.log(`DUOQ detected in game ${riotGameId} for team ${teamId}:`, teammates.map(t => t.user_name));
  }

  let betOption = await db.betOption.findFirst({
    where: {
      bo_game: riotGameId,
      bo_title: "Parier sur l'issue de la partie"
    }
  });

  if (!betOption) {
    betOption = await db.betOption.create({
      data: {
        bo_game: riotGameId,
        bo_title: "Parier sur l'issue de la partie",
        bo_state: "OPEN"
      }
    });

    await db.gameOdd.create({
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