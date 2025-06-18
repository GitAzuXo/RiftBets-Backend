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
        const alreadyLinked = await db.riot_data.findFirst({
            where: { rd_puuid: summonerDatas.puuid },
        });

        if (!alreadyLinked) {
            const riotData = await db.riot_data.create({
                data: {
                    rd_tagline: riottagline,
                    rd_puuid: summonerDatas.puuid,
                    rd_suuid: summonerDatas.suuid,
                    rd_level: summonerDatas.level,
                    rd_icon: summonerDatas.icon
                }
            });
            await db.user_account.create({
                data: {
                    user_name: username,
                    rd_id: riotData.rd_id
                }
            });
            res.json({ message: "Thank you for linking your account"});
            await getMatchesStats(summonerDatas.puuid);
            return;
        }
        await getMatchesStats(summonerDatas.puuid);

        // Update riot_data if already exists
        await db.riot_data.update({
            where: { rd_id: alreadyLinked.rd_id },
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

export async function autoCreateProposals() {
    const users = await db.riot_data.findMany({
        where: {
            rd_puuid: {
                not: undefined
            }
        },
        select: {
            rd_puuid: true,
            user_account: {
                select: {
                    user_name: true
                }
            }
        }
    });

    let proposalsCreated = 0;

    for (const user of users) {
        const puuid = user.rd_puuid;
        const username = user.user_account?.[0]?.user_name;

        if (!username) continue;

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

            const accountId = await db.riot_data.findFirst({
                where: { rd_puuid: puuid },
                select: { rd_id: true }
            });
            

            if (!exists && accountId != null) {
                await getMatchesStats(puuid);
                await openOrJoinGame(username, accountId.rd_id, gameId, teamId, champion, BigInt(gameTime));
                proposalsCreated++;
            } else {
                console.log(`Proposal already exists for gameId=${gameId}, skipping creation.`);
            }
        }
    }

    console.log(`[autoCreateProposals] ${proposalsCreated} proposals created.`);
}

router.delete("/delete/:rd_id", passport.authenticate("jwt", { session: false }), async (req, res) => {
    if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
        res.status(401).json({ message: "Unauthorized: User not found" });
        return;
    }
    try {
        const rd_id = parseInt(req.params.rd_id, 10);
        if (isNaN(rd_id)) {
            res.status(400).json({ error: "Invalid rd_id" });
            return;
        }
        const xdeleted = await db.user_account.deleteMany({
            where: { rd_id, user_name: (req.user as { username: string }).username }
        });

        if(xdeleted){
            const deleted = await db.riot_data.delete({
                where: { rd_id }
            });
            res.json({ message: "Account deleted successfully", tagline: deleted.rd_tagline });
        }
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;