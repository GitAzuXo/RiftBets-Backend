import { Router } from "express";
import { db } from "../index";
import { RowDataPacket } from "mysql2";
import passport from "../auth/passport";

const router = Router();

router.post("/bet", passport.authenticate("jwt", { session: false }), async (req, res) => {
    const { proposalId, betAmount } = req.body;

    if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
        res.status(401).json({ message: "Unauthorized: User not found" });
        return;
    }

    const username = req.user.username;

    const sqlCheck = "SELECT user_coins FROM user WHERE user_name = ?";
    const sqlId = "SELECT user_id FROM user WHERE user_name = ?";
    const sqlInsert = "INSERT INTO bet (bet_user, bet_proposal, bet_amount) VALUES (?, ?, ?)";
    const sqlUpdate = "UPDATE user SET user_coins = user_coins - ? WHERE user_name = ?";

    try {
        const [rows] = await db.query<RowDataPacket[]>(sqlCheck, [username]);

        if (rows.length === 0) {
            res.status(404).json({ message: "User not found" });
        }

        const userCoins = rows[0].user_coins;

        const [rows1] = await db.query<RowDataPacket[]>(sqlId, [username]);

        if (rows1.length === 0) {
            res.status(404).json({ message: "Id not found" });
        }

        const userId = rows1[0].user_id;

        if (userCoins < betAmount) {
            res.status(400).json({ message: "Insufficient coins" });
        }

        await db.query(sqlInsert, [userId, proposalId, betAmount]);
        await db.query(sqlUpdate, [betAmount, username]);

        res.status(200).json({ message: "Bet placed successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

export default router;