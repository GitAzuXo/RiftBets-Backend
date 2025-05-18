import { Router } from "express";
import passport from "passport";
import { db } from "../index";
import { RowDataPacket } from "mysql2";

const router = Router();

router.get(
  "/profile",
  passport.authenticate("jwt", { session: false }),
  (req, res) => {
    console.log("Incoming request to /profile");
    console.log("User from token:", req.user);

    if (!req.user || typeof req.user !== "object" || !("username" in req.user)) {
      console.error("Unauthorized: User not found");
      res.status(401).json({ message: "Unauthorized: User not found" });
      return;
    }

    const username = req.user.username;
    console.log("Username:", username);

    const sql = `
      SELECT
        u.user_id,
        u.user_name,
        u.user_role,
        u.user_coins,
        u.user_creation,
        u.user_daily,
        u.user_dailytime,
        COUNT(b.bet_id) AS total_bets,
        SUM(CASE WHEN b.bet_result = 'win' THEN 1 ELSE 0 END) AS total_wins,
        CASE
          WHEN lb.bet_id IS NULL THEN 'No Bet'
          WHEN lb.bet_result = 'win' THEN CONCAT('+', lb.bet_amount * (p.prop_odds - 1))
          WHEN lb.bet_result = 'lose' THEN CONCAT('-', lb.bet_amount)
          ELSE 'No Bet'
        END AS last_bet_gain_or_loss
      FROM user u
      LEFT JOIN bet b ON b.bet_user = u.user_id
      LEFT JOIN (
        SELECT *
        FROM bet
        WHERE bet_user = (
          SELECT user_id FROM user WHERE user_name = ?
        )
        ORDER BY bet_id DESC
        LIMIT 1
      ) lb ON lb.bet_user = u.user_id
      LEFT JOIN proposals p ON p.prop_id = lb.bet_proposal
      WHERE u.user_name = ?
      GROUP BY u.user_id, u.user_name, u.user_role, u.user_coins, u.user_creation,
               lb.bet_id, lb.bet_result, lb.bet_amount, p.prop_odds
    `;

    db.query<RowDataPacket[]>(sql, [username, username])
      .then(([results]) => {
        if (results.length === 0) {
          console.error("User not found in database");
          res.status(404).json({ message: "User not found" });
          return;
        }

        const user = results[0];
        res.json({
          id: user.user_id,
          username: user.user_name,
          role: user.user_role,
          balance: user.user_coins,
          creation: user.user_creation,
          totalBets: user.total_bets,
          totalWins: user.total_wins,
          lastBetGainOrLoss: user.last_bet_gain_or_loss,
          daily: user.user_daily,
          daily_time: user.user_dailytime,
        });
      })
      .catch((err: Error) => {
        console.error("Database error:", err.message);
        res.status(500).json({ message: "Database error", error: err.message });
      });
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

    const sqlId = "SELECT user_id FROM user WHERE user_name = ?";
    const sql = `
      SELECT 
          b.*, 
          p.*, 
          (b.bet_amount * p.prop_odds) AS potential_gain
      FROM bet b
      JOIN proposals p ON b.bet_proposal = p.prop_id
      WHERE b.bet_user = ?;`;

    const [rows1] = await db.query<RowDataPacket[]>(sqlId, [username]);

    if (rows1.length === 0) {
        res.status(404).json({ message: "Id not found" });
    }

    const userId = rows1[0].user_id;

    db.query<RowDataPacket[]>(sql, [userId])
      .then(([results]) => {
        if (results.length === 0) {
          res.status(404).json({ message: "User not found" });
          return;
        }
        res.json(results);
      })
      .catch((err: Error) => {
        res.status(500).json({ message: "Database error", error: err.message });
      });
  }
);


router.get("/all", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM user");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

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
      const sqlCheck = "SELECT user_daily, user_dailytime FROM user WHERE user_name = ?";
      const [rows] = await db.query<RowDataPacket[]>(sqlCheck, [username]);

      if (rows.length === 0) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const user = rows[0];
      const currentDate = new Date();
      const lastClaimDate = new Date(user.user_dailytime);
      const oneDayInMs = 24 * 60 * 60 * 1000;

      if (user.user_daily && currentDate.getTime() - lastClaimDate.getTime() < oneDayInMs) {
        res.status(400).json({ message: "Daily reward already claimed" });
        return;
      }

      const currentDateWithoutSeconds = currentDate.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm

      const sqlUpdate = `
        UPDATE user
        SET user_coins = user_coins + 5, user_daily = true, user_dailytime = ?
        WHERE user_name = ?
      `;

      await db.query(sqlUpdate, [currentDateWithoutSeconds, username]);

      res.json({ message: "Daily reward claimed successfully", reward: 5 });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Database error" });
    }
  }
);


router.get("/leaderboard", async (req, res) => {
  try {
    const sql = `
      SELECT 
      u.user_name, 
      u.user_coins,
      COUNT(b.bet_id) AS total_bets,
      IFNULL(
        ROUND(
        (SUM(CASE WHEN b.bet_result = 'WIN' THEN 1 ELSE 0 END) / NULLIF(COUNT(b.bet_id), 0)) * 100, 
        2
        ), 
        0
      ) AS winrate
      FROM user u
      LEFT JOIN bet b ON b.bet_user = u.user_id
      WHERE u.user_name <> 'ADMIN'
      GROUP BY u.user_id, u.user_name, u.user_coins
      ORDER BY u.user_coins DESC
    `;
    const [rows] = await db.query<RowDataPacket[]>(sql);
    res.json(rows);
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

export default router;
