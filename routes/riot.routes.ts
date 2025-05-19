import passport from "passport";
import { db } from "../index";
import { RowDataPacket } from "mysql2";
import { requireAdmin } from "./auth.routes";
import express from "express";
import { fetchAndStorePuuid } from "../riot_watcher/riot_watcher";

const router = express.Router();

router.post("/create", passport.authenticate("jwt", { session: false }),async (req, res) => {
        const sqlId = "SELECT user_id FROM user WHERE user_name = ?";
        try {
            const { name, tagline } = req.body;
            if (!tagline || !name) {
                res.status(400).json({ error: "Name and Tagline are required" });
            }

            // Call your riot_watcher function to get the puuid
            const puuid = await fetchAndStorePuuid(name, tagline);
            if (!puuid) {
                res.status(404).json({ error: "Riot profile not found" });
            }

            if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
                res.status(401).json({ message: "Unauthorized: User not found" });
                return;
            }

            const username = req.user.username;

            const [rows1] = await db.query<RowDataPacket[]>(sqlId, [username]);

                if (rows1.length === 0) {
                    res.status(404).json({ message: "Id not found" });
                    return;
                }

            const userId = rows1[0].user_id;

            const riottagline = name + "#" + tagline;

            await db.execute(
                "INSERT INTO riotdata (riot_user, riot_tagline, riot_puuid) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE puuid = VALUES(puuid), tagline = VALUES(tagline)",
                [userId, riottagline, puuid]
            );

            res.json({ message: "Riot data created successfully"});
        } catch (error) {
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

export default router;