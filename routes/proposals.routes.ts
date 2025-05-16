import { Router } from "express";
import { db } from "../index";
import { RowDataPacket } from "mysql2";
import passport from "../auth/passport";
import { requireAdmin } from "./auth.routes";

const router = Router();

router.get("/getAll", (req, res) => {
    const sql = `
    SELECT 
        p.*, 
        COALESCE(SUM(b.bet_amount), 0) AS prop_total_amount,
        COUNT(DISTINCT b.bet_user) AS prop_nbPeople
    FROM proposals p
    WHERE p.prop_available = 1
    LEFT JOIN bet b ON p.prop_id = b.bet_proposal
    GROUP BY p.prop_id, p.prop_player, p.prop_title, p.prop_odds, p.prop_creation, p.prop_available;`;
    db.query<RowDataPacket[]>(sql).then(([results]) => {
        if (results.length === 0) {
            return res.status(404).json({ message: "No proposals found" });
        }
        return res.status(200).json(results);
    }).catch((err: Error) => {  
        return res.status(500).json({ message: "Database error", error: err.message });
    });
});

router.post("/finish", passport.authenticate("jwt", { session: false }), async (req, res) => {
    const { proposalId, result } = req.body;

    if (!await requireAdmin(req)) {
        res.status(403).json({ message: "Unauthorized: Admin access required" });
    }

    if (!proposalId || !["WIN", "LOSE"].includes(result)) {
        res.status(400).json({ message: "Invalid input" });
    }

    try {
        // Get proposal details
        const [proposalRows] = await db.query<RowDataPacket[]>(
            "SELECT * FROM proposals WHERE prop_id = ? AND prop_available = 1",
            [proposalId]
        );
        if (proposalRows.length === 0) {
            res.status(404).json({ message: "Proposal not found or already finished" });
        }
        const proposal = proposalRows[0];

        const [betRows] = await db.query<RowDataPacket[]>(
            "SELECT * FROM bet WHERE bet_proposal = ?",
            [proposalId]
        );

        // Calculate payouts and update user balances
        for (const bet of betRows) {
            let payout = 0;
            if (
                (result === "WIN")
            ) {
                payout = bet.bet_amount * proposal.prop_odds;
                await db.query(
                    "UPDATE user SET user_coins = user_coins + ? WHERE user_id = ?",
                    [payout, bet.bet_user]
                );

                await db.query(
                    "UPDATE bet SET bet_state = 'FINISHED', bet_result = 'WIN' WHERE bet_proposal = ?, bet_user = ?",
                    [proposalId, bet.bet_user]
                );
            } else {
                await db.query(
                    "UPDATE bet SET bet_state = 'FINISHED', bet_result = 'LOSE' WHERE bet_proposal = ?, bet_user = ?",
                    [proposalId, bet.bet_user]
                );
            }
        }

        await db.query(
            "UPDATE proposals SET prop_available = 0 WHERE prop_id = ?",
            [proposalId]
        );

        res.status(200).json({ message: "Proposal finished and payouts processed" });
    } catch (err: any) {
        res.status(500).json({ message: "Database error", error: err.message });
    }
});

export default router;