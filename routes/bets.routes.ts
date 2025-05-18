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
    const sqlBetCheck = "SELECT bet_id, bet_amount FROM bet WHERE bet_user = ? AND bet_proposal = ?";
    const sqlInsert = "INSERT INTO bet (bet_user, bet_proposal, bet_amount) VALUES (?, ?, ?)";
    const sqlUpdateBet = "UPDATE bet SET bet_amount = bet_amount + ? WHERE bet_id = ?";
    const sqlUpdateCoins = "UPDATE user SET user_coins = user_coins - ? WHERE user_name = ?";

    try {
        const [rows] = await db.query<RowDataPacket[]>(sqlCheck, [username]);

        if (rows.length === 0) {
            res.status(404).json({ message: "User not found" });
            return;
        }

        const userCoins = rows[0].user_coins;

        const [rows1] = await db.query<RowDataPacket[]>(sqlId, [username]);

        if (rows1.length === 0) {
            res.status(404).json({ message: "Id not found" });
            return;
        }

        const userId = rows1[0].user_id;

        if (userCoins < betAmount) {
            res.status(400).json({ message: "Insufficient coins" });
            return;
        }

        const [betRows] = await db.query<RowDataPacket[]>(sqlBetCheck, [userId, proposalId]);

        if (betRows.length > 0) {
            const betId = betRows[0].bet_id;
            await db.query(sqlUpdateBet, [betAmount, betId]);
        } else {
            await db.query(sqlInsert, [userId, proposalId, betAmount]);
        }

        await db.query(sqlUpdateCoins, [betAmount, username]);

        res.status(200).json({ message: "Bet placed successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

router.get("/last", async (req, res) => {
    const sql = `
        SELECT 
            b.bet_amount, 
            b.bet_proposal, 
            b.bet_user, 
            u.user_name, 
            b.bet_creation,
            p.* 
        FROM bet b
        JOIN user u ON b.bet_user = u.user_id
        JOIN proposals p ON b.bet_proposal = p.prop_id
        ORDER BY b.bet_creation DESC
        LIMIT 3
    `;
    try {
        const [rows] = await db.query<RowDataPacket[]>(sql);
        res.status(200).json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

export default router;