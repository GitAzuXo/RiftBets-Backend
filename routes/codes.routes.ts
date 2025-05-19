import { Router } from "express";
import passport from "passport";
import { db } from "../index";
import { RowDataPacket } from "mysql2";
import { requireAdmin } from "./auth.routes";

const router = Router();

router.post("/use", passport.authenticate("jwt", { session: false }), async (req, res) => {
    const { code } = req.body;
    const sqlId = "SELECT user_id FROM user WHERE user_name = ?";
    const sqlUpdateUser = "UPDATE user SET user_coins = user_coins + ? WHERE user_id = ?";

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

    if (!code || !userId) {
        res.status(400).json({ message: "Code and user required." });
    }

    try {
        const [rows] = await db.query<RowDataPacket[]>(
            "SELECT * FROM codes WHERE code_string = ? AND code_state = 'AVAILABLE'",
            [code]
        );
        if (rows.length === 0) {
            res.status(404).json({ message: "Code not found or already used." });
        }

        await db.query(
            "UPDATE codes SET code_state = 'USED', code_user = ?, code_usedtime = NOW() WHERE code_string = ?",
            [userId, code]
        );

        const reward = rows[0].code_reward;
        await db.query(sqlUpdateUser, [reward, userId]);
        res.json({ message: "Code used successfully.", reward });
    } catch (err) {
        res.status(500).json({ message: "Server error.", error: err });
    }
});

router.post("/add", passport.authenticate("jwt", { session: false }), async (req, res) => {
    const { code_string, code_reward } = req.body;

    if (!await requireAdmin(req)) {
            res.status(403).json({ message: "Unauthorized: Admin access required" });
        }

    if (!code_string || typeof code_reward !== "number") {
        res.status(400).json({ message: "Code string and reward are required." });
        return;
    }

    try {
        const [existing] = await db.query<RowDataPacket[]>(
            "SELECT * FROM codes WHERE code_string = ?",
            [code_string]
        );
        if (existing.length > 0) {
            res.status(409).json({ message: "Code already exists." });
            return;
        }

        await db.query(
            "INSERT INTO codes (code_string, code_reward, code_state) VALUES (?, ?, 'AVAILABLE')",
            [code_string, code_reward]
        );
        res.status(201).json({ message: "Code added successfully." });
    } catch (err) {
        res.status(500).json({ message: "Server error.", error: err });
    }
});

export default router;