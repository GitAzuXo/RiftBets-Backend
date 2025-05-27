import { Router } from "express";
import passport from "passport";
import { db } from "../index";

const router = Router();

router.get(
  "/profile",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
      res.status(401).json({ message: "Unauthorized: User not found" });
      return;
    }

    const username = req.user.username;

    try {
      const user = await db.user.findUnique({
        where: { user_name: username as string },
        include: {
          bets: {
            orderBy: { bet_id: "desc" },
            take: 1,
            include: { betOption: true }
          },
          riot_data: true
        }
      });

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const totalBets = await db.bet.count({
        where: { bet_user: user.user_name }
      });

      const totalWins = await db.bet.count({
        where: {
          bet_user: user.user_name,
          bet_state: "WON"
        }
      });

      let lastBetGainOrLoss = "No Bet";
      let lastBet = null;
      if (user.bets && user.bets.length > 0) {
        lastBet = user.bets[0];
        if (lastBet.bet_state === "WON") {
          lastBetGainOrLoss = `+${Number(lastBet.bet_amount) * (Number(lastBet.bet_odd) - 1)}`;
        } else if (lastBet.bet_state === "LOST") {
          lastBetGainOrLoss = `-${lastBet.bet_amount}`;
        }
      }

      let icon = null;
      let level = null;
      if (user.riot_data) {
        icon = user.riot_data.rd_icon ?? null;
        level = user.riot_data.rd_level ?? null;
      }

      res.json({
        username: user.user_name,
        role: user.user_role,
        balance: user.user_balance,
        totalBets,
        totalWins,
        lastBetGainOrLoss,
        icon,
        level,
        daily: user.user_daily
      });
    } catch (err: any) {
      res.status(500).json({ message: "Database error", error: err.message });
    }
  }
);

router.get(
  "/getBets",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
      res.status(401).json({ message: "Unauthorized: User not found" });
      return;
    }

    const username = req.user.username;

    try {
      const user = await db.user.findUnique({
        where: { user_name: username as string },
        select: { user_name: true }
      });

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const bets = await db.bet.findMany({
        where: { bet_user: username as string },
        include: {
          betOption: true
        },
        orderBy: { bet_id: "desc" }
      });

      const betsWithGain = bets.map(bet => ({
        ...bet,
        potential_gain: Number(bet.bet_amount) * Number(bet.bet_odd)
      }));

      res.json(betsWithGain);
    } catch (err: any) {
      res.status(500).json({ message: "Database error", error: err.message });
    }
  }
);


/**router.get("/getAll", async (req, res) => {
  try {
    const users = await db.user.findMany();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});**/

router.post(
  "/dailyReward",
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
      res.status(401).json({ message: "Unauthorized: User not found" });
      return;
    }

    const username = req.user.username;

    try {
      const user = await db.user.findUnique({
        where: { user_name: username as string },
        select: { user_daily: true, user_balance: true }
      });

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const now = new Date();
      const lastClaim = user.user_daily as Date | null;

      if (lastClaim && now.getTime() - new Date(lastClaim).getTime() < 24 * 60 * 60 * 1000) {
        res.status(400).json({ message: "Daily reward already claimed" });
        return;
      }

      await db.user.update({
        where: { user_name: username as string },
        data: {
          user_balance: { increment: 10 },
          user_daily: now
        }
      });

      res.json({ message: "Daily reward claimed successfully", reward: 10 });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Database error" });
    }
  }
);


router.get("/leaderboard", async (req, res) => {
  try {
    // Get all users except ADMIN
    const users = await db.user.findMany({
      where: { NOT: { user_name: "ADMIN" } },
      select: {
        user_name: true,
        user_balance: true,
        bets: {
          select: {
            bet_id: true,
            bet_state: true
          }
        }
      }
    });

    // Calculate leaderboard data
    const leaderboard = users
      .map(user => {
        const totalBets = user.bets.length;
        const finishedBets = user.bets.filter(bet => bet.bet_state === "WON" || bet.bet_state === "LOST");
        const winCount = user.bets.filter(bet => bet.bet_state === "WON").length;
        const winrate = finishedBets.length > 0 ? Number(((winCount / finishedBets.length) * 100).toFixed(2)) : 0;
        return {
          user_name: user.user_name,
          user_coins: user.user_balance,
          total_bets: totalBets,
          winrate
        };
      })
      .filter(user => user.total_bets >= 5)
      .sort((a, b) => Number(b.user_coins) - Number(a.user_coins));

    res.json(leaderboard);
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
