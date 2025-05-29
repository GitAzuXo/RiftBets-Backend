import { Router } from "express";
import { db } from "../index";
import passport from "passport";
import { requireAdmin } from "./auth.routes";

const router = Router();

router.post("/game", async (req, res) => {
    try {
        const { gameId } = req.body;
        if (typeof gameId !== "string" && typeof gameId !== "number") {
            res.status(400).json({ error: "Invalid gameId parameter" });
            return;
        }

        // Fetch all bet options for the game
        const betOptions = await db.bet_option.findMany({
            where: { bo_game: BigInt(gameId) }
        });

        // Fetch all bets for these bet options
        const betOptionIds = betOptions.map(opt => opt.bo_id);
        const bets = await db.bet.findMany({
            where: { bet_bo: { in: betOptionIds } },
            select: {
                bet_bo: true,
                bet_user: true,
                bet_amount: true
            }
        });

        // Fetch odds from game_odd table for these bet options
        const gameOdds = await db.game_odd.findMany({
            where: { odd_bo: { in: betOptionIds } },
            select: {
                odd_bo: true,
                odd_lose: true,
                odd_win: true
            }
        });
        // Map odds by bet option id
        const oddsMap = new Map<number, { odd_win: number, odd_lose: number }>();
        for (const odd of gameOdds) {
            oddsMap.set(odd.odd_bo, {
                odd_win: Number(odd.odd_win),
                odd_lose: Number(odd.odd_lose)
            });
        }

        // Aggregate data for each bet option
        const betStats: Record<number, { totalCoins: number, userSet: Set<string> }> = {};
        for (const bet of bets) {
            const boId = bet.bet_bo;
            if (!betStats[boId]) {
                betStats[boId] = { totalCoins: 0, userSet: new Set() };
            }
            betStats[boId].totalCoins += Number(bet.bet_amount);
            betStats[boId].userSet.add(bet.bet_user);
        }

        // Serialize response
        const serialized = betOptions.map(opt => {
            const stats = betStats[opt.bo_id] || { totalCoins: 0, userSet: new Set() };
            const odds = oddsMap.get(opt.bo_id) || { odd_win: null, odd_lose: null };
            return {
                ...opt,
                bo_game: opt.bo_game.toString(),
                coins_bet: stats.totalCoins,
                users_bet: stats.userSet.size,
                odd_win: odds.odd_win,
                odd_lose: odds.odd_lose
            };
        });

        res.json(serialized);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch bet options" });
    }
});

router.post("/close", passport.authenticate("jwt", { session: false }), async (req, res) => {

    if(!requireAdmin(req)) {
        res.status(403).json({ message: "Unauthorized: Admin access required" });
        return;
    }
    try {
        const { betOptionId } = req.body;
        await db.bet_option.update({
            where: { bo_id: Number(betOptionId) },
            data: { bo_state: 'CLOSED' }
        });
        res.status(200).json({message: "Bet option closed successfully"});
    } catch (error) {
        res.status(500).json({ error: "Failed to close bet option" });
    }
});

export default router;