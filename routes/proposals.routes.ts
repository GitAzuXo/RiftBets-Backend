import { Router } from "express";
import { db } from "../index";
import { RowDataPacket } from "mysql2";

const router = Router();

router.get("/getAll", (req, res) => {
    const sql = `
    SELECT 
        p.*, 
        COALESCE(SUM(b.bet_amount), 0) AS prop_total_amount,
        COUNT(DISTINCT b.bet_user) AS prop_nbPeople
    FROM proposals p
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

export default router;