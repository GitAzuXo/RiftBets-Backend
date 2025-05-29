import passport from "passport";
import { db } from "../index";
import express from "express";
import { fetchAndStorePuuid } from "../riot_watcher/riot_watcher";
import { getMatchesStats } from "../riot_watcher/riot_watcher";
import { fetchCurrentMatch } from "../riot_watcher/riot_watcher";
import { openOrJoinGame } from "./game.routes";

const router = express.Router();

router.post("/create", passport.authenticate("jwt", { session: false }), async (req, res) => {
    try {
        const { name, tagline } = req.body;
        if (!tagline || !name) {
            res.status(400).json({ error: "Name and Tagline are required" });
            return;
        }

        const summonerDatas = await fetchAndStorePuuid(name, tagline);
        if (!summonerDatas.puuid) {
            res.status(404).json({ error: "Riot profile not found" });
            return;
        }

        if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
            res.status(401).json({ message: "Unauthorized: User not found" });
            return;
        }

        const username = (req.user as { username: string }).username;
        const riottagline = name + "#" + tagline;

        // Check if already linked
        const alreadyLinked = await db.riot_data.findUnique({
            where: { rd_user: username }
        });

        if (!alreadyLinked) {
            await db.user.update({
                where: { user_name: username },
                data: { user_balance: { increment: 20 } }
            });
            // Insert new riot_data
            await db.riot_data.create({
                data: {
                    rd_user: username,
                    rd_tagline: riottagline,
                    rd_puuid: summonerDatas.puuid,
                    rd_suuid: summonerDatas.suuid,
                    rd_level: summonerDatas.level,
                    rd_icon: summonerDatas.icon
                }
            });
            res.json({ message: "Thank you for linking your account"});
            return;
        }
        await getMatchesStats(summonerDatas.puuid);

        // Update riot_data if already exists
        await db.riot_data.update({
            where: { rd_user: username },
            data: {
                rd_tagline: riottagline,
                rd_puuid: summonerDatas.puuid,
                rd_suuid: summonerDatas.suuid,
                rd_level: summonerDatas.level,
                rd_icon: summonerDatas.icon
            }
        });

        res.json({ message: "Account updated successfully", icon: summonerDatas.icon, level: summonerDatas.level });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

/**router.post("/matchdata", passport.authenticate("jwt", { session: false }), async (req, res) => {
    const sqlId = "SELECT user_id FROM user WHERE user_name = ?";
    try {
        const { puuid } = req.body;
        if (!puuid) {
            res.status(400).json({ error: "Puuid is required" });
            return;
        }

        const username = (req.user as { username: string }).username;

        const [rows1] = await db.query<RowDataPacket[]>(sqlId, [username]);

        if (rows1.length === 0) {
            res.status(404).json({ message: "Id not found" });
            return;
        }

        const userId = rows1[0].user_id;

        const data = await getMatchesStats(puuid);

        await db.execute("INSERT INTO riotdata (riot_user, riot_winrate, riot_csm, riot_kda) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE riot_user = VALUES(riot_user), riot_winrate = VALUES(riot_winrate), riot_csm = VALUES(riot_csm), riot_kda = VALUES(riot_kda);",[userId, data.winrate, data.avgCSPerMin, data.avgKDA]);

        res.json({ message: "Riot data updated successfully" });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});**/

export async function autoCreateProposals() {
    const users = await db.riot_data.findMany({
        where: {
            rd_puuid: {
                not: undefined
            }
        },
        select: {
            rd_user: true,
            rd_puuid: true
        }
    });

    let proposalsCreated = 0;

    for (const user of users) {
        const puuid = user.rd_puuid;
        const username = user.rd_user;

        const currentGame = await fetchCurrentMatch(puuid);

        if (currentGame && currentGame.id) {
            const gameId = currentGame.id;
            const champion = currentGame.champion;
            const gameTime = currentGame.time;
            const teamId = currentGame.team;

            // Check if proposal already exists
            const exists = await db.bet_option.findFirst({
                where: { bo_game: gameId },
                select: { bo_id: true }
            });

            if (!exists) {
                await getMatchesStats(puuid);
                await openOrJoinGame(username, gameId, teamId, champion, BigInt(gameTime));
                proposalsCreated++;
            } else {
                console.log(`Proposal already exists for gameId=${gameId}, skipping creation.`);
            }
        }
    }

    console.log(`[autoCreateProposals] ${proposalsCreated} proposals created.`);
}

export default router;