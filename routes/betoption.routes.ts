import { Router } from "express";
import { db } from "../index";

const router = Router();

router.get("/game/:gameId", async (req, res) => {
    try {
        const { gameId } = req.params;
        const betOptions = await db.bet_option.findMany({
            where: { bo_game: Number(gameId) }
        });
        res.json(betOptions);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch bet options" });
    }
});

router.post("/close/:betOptionId", async (req, res) => {
    try {
        const { betOptionId } = req.params;
        const updatedBetOption = await db.bet_option.update({
            where: { bo_id: Number(betOptionId) },
            data: { bo_state: 'CLOSED' }
        });
        res.json(updatedBetOption);
    } catch (error) {
        res.status(500).json({ error: "Failed to close bet option" });
    }
});

export default router;