import { Router } from "express";
import { db } from "../index";
import { RowDataPacket } from "mysql2";
import passport from "../auth/passport";
import { PrismaClient } from "@prisma/client";

const router = Router();

router.post(
    "/bet",
    passport.authenticate("jwt", { session: false }),
    async (req, res) => {
        const { optionId, betAmount, betSide } = req.body;

        if (
            !req.user ||
            typeof req.user !== "object" ||
            !("username" in req.user)
        ) {
            res.status(401).json({ message: "Unauthorized: User not found" });
            return;
        }

        const username = req.user.username;

        try {
            // Get user and proposal
            const user = await db.user.findUnique({
                where: { user_name: username as string },
            });
            if (!user) {
                res.status(404).json({ message: "User not found" });
                return;
            }

            const betoption = await db.bet_option.findUnique({
                where: { bo_id: optionId },
            });
            if (!betoption) {
                res.status(404).json({ message: "Betting option not found" });
                return;
            }
            if (betoption.bo_state !== "OPEN") {
                res.status(400).json({ message: "Betting option is not open for betting" });
                return;
            }

            if (user.user_balance < betAmount) {
                res.status(400).json({ message: "Insufficient coins" });
                return;
            }

            // Check if user already bet on this side for this proposal
            const existingBet = await db.bet.findFirst({
                where: {
                    bet_user: user.user_name,
                    bet_bo: optionId,
                    bet_side: betSide,
                },
            });
            if (existingBet) {
                res
                    .status(400)
                    .json({
                        message: "You have already placed a bet on this side for this proposal.",
                    });
                return;
            }

            // Get odds from game_odds table
            const gameOdds = await db.game_odd.findUnique({
                where: { game_id_odd_bo: { game_id: betoption.bo_game, odd_bo: betoption.bo_id } },
            });
            if (!gameOdds) {
                res.status(404).json({ message: "Game odds not found" });
                return;
            }

            // Insert bet
            await db.bet.create({
                data: {
                    bet_user: user.user_name,
                    bet_bo: optionId,
                    bet_amount: betAmount,
                    bet_side: betSide,
                    bet_odd:
                        betSide === "WIN"
                            ? gameOdds.odd_win
                            : gameOdds.odd_lose
                },
            });

            // Update user coins
            await db.user.update({
                where: { user_name: username as string },
                data: { user_balance: { decrement: betAmount } },
            });

            // Calculate new odds
            const [totalWin, totalLose] = await Promise.all([
                db.bet.aggregate({
                    _sum: { bet_amount: true },
                    where: { bet_bo: optionId, bet_side: 1 },
                }),
                db.bet.aggregate({
                    _sum: { bet_amount: true },
                    where: { bet_bo: optionId, bet_side: 0 },
                }),
            ]);
            const amountonvictory = totalWin._sum.bet_amount || 0;
            const amountondefeat = totalLose._sum.bet_amount || 0;

            let gamma = 0.1;
            const victoryAmountNum = typeof amountonvictory === "object" && typeof amountonvictory.toNumber === "function"
                ? amountonvictory.toNumber()
                : Number(amountonvictory);
            const defeatAmountNum = typeof amountondefeat === "object" && typeof amountondefeat.toNumber === "function"
                ? amountondefeat.toNumber()
                : Number(amountondefeat);

            if (victoryAmountNum >= 100 || defeatAmountNum >= 100) {
                gamma = 0.3;
            } else if (victoryAmountNum >= 50 || defeatAmountNum >= 50) {
                gamma = 0.2;
            }
            let winquote: number;
            let losequote: number;
            const totalAmount = Number(amountonvictory) + Number(amountondefeat);
            if (totalAmount === 0) {
                winquote = 2;
                losequote = 2;
            } else {
                winquote =
                    2 -
                    gamma *
                        (Number(amountonvictory) - Number(amountondefeat)) /
                        totalAmount;
                losequote = 4 - winquote;
            }

            // Update proposal odds
            await db.game_odd.update({
                where: { game_id_odd_bo: { game_id: betoption.bo_game, odd_bo: betoption.bo_id } },
                data: {
                    odd_win: winquote,
                    odd_lose: losequote,
                },
            });

            res.status(200).json({ message: "Bet placed successfully" });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Database error" });
        }
    }
);

router.get("/last", async (req, res) => {
    try {
        const bets = await db.bet.findMany({
            orderBy: { bet_timestamp: "desc" },
            take: 3,
            include: {
                user: true,
                betOption: true,
            },
        });

        // Map to match the original SQL output structure
        const result = bets.map(bet => ({
            bet_amount: bet.bet_amount,
            bet_option: bet.betOption,
            bet_user: bet.bet_user,
            bet_side: bet.bet_side,
            bet_odd: bet.bet_odd,
            user_name: bet.user?.user_name,
            bet_creation: bet.bet_timestamp,
            ...bet.betOption
        }));

        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

export default router;