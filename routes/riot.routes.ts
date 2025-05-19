import passport from "passport";
import { db } from "../index";
import { RowDataPacket } from "mysql2";
import { requireAdmin } from "./auth.routes";
import express from "express";
import { fetchAndStorePuuid } from "../riot_watcher/riot_watcher";
import { getMatchesStats } from "../riot_watcher/riot_watcher";

const router = express.Router();

router.post("/create", passport.authenticate("jwt", { session: false }), async (req, res) => {
    const sqlId = "SELECT user_id FROM user WHERE user_name = ?";
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

        const [rows1] = await db.query<RowDataPacket[]>(sqlId, [username]);

        if (rows1.length === 0) {
            res.status(404).json({ message: "Id not found" });
            return;
        }

        const userId = rows1[0].user_id;
        const riottagline = name + "#" + tagline;

        await db.execute("INSERT INTO riotdata (riot_user, riot_tagline, riot_puuid, riot_suuid, riot_level, riot_icon) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE riot_user = VALUES(riot_user), riot_tagline = VALUES(riot_tagline), riot_puuid = VALUES(riot_puuid), riot_suuid = VALUES(riot_suuid), riot_level = VALUES(riot_level), riot_icon = VALUES(riot_icon);",[userId, riottagline, summonerDatas.puuid, summonerDatas.suuid, summonerDatas.level, summonerDatas.icon]);

        res.json({ message: "Riot data created successfully" });
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/matchdata", passport.authenticate("jwt", { session: false }), async (req, res) => {
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
});

export default router;