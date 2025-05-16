import { Router, Request, Response } from "express";
import passport from "../auth/passport";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { db } from "../index";
import { RowDataPacket, ResultSetHeader, FieldPacket } from "mysql2";

const router = Router();
dotenv.config();

router.post("/login", (req: Request, res: Response) => {
  const { username, password } = req.body;

  db.query<RowDataPacket[]>("SELECT user_name FROM user WHERE user_name = ? AND user_password = ?", [username, password])
    .then(([results]: [any[], any]) => {
      if (results.length === 0) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const user = results[0];
      const payload = { username: user.user_name };
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ message: "JWT secret is not defined" });
      }
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

      return res.json({ message: "Login successful", token });
    })
    .catch((err: Error) => {
      return res.status(500).json({ message: "Database error", error: err.message });
    });
});

router.post("/register", (req: Request, res: Response) => {
  const { username, password, balance = 0 } = req.body;

  // Check if the username already exists
  db.query<RowDataPacket[]>("SELECT user_name FROM user WHERE user_name = ?", [username])
    .then(([results]: [RowDataPacket[], FieldPacket[]]) => {
      if (results.length > 0) {
        // Pass an error message to Promise.reject()
        return Promise.reject(new Error("Username already exists"));
      }
      // Proceed to insert the new user
      return db.query<ResultSetHeader>(
        "INSERT INTO user (user_name, user_password, user_coins) VALUES (?, ?, ?)",
        [username, password, balance]
      );
    })
    .then(([results]: [ResultSetHeader, FieldPacket[]]) => {
      if (results.affectedRows === 0) {
        return Promise.reject(new Error("Registration failed"));
      }
      const payload = { username: username };
      if (!process.env.JWT_SECRET) {
        return Promise.reject(new Error("JWT secret is not defined"));
      }
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });
      // Send success response
      return res.status(201).json({ message: "User registered successfully", token });
    })
    .catch((err: Error) => {
      // Handle errors and send response
      return res.status(500).json({ message: err.message || "Database error" });
    });
});

// Protected route example
router.get("/protected", passport.authenticate("jwt", { session: false }),
  (req: Request, res: Response) => {
    res.json({ message: "You have accessed a protected route!", user: req.user });
  }
);

export const requireAdmin = async (req: Request): Promise<boolean> => {
  try {
    const user = req.user as { username?: string };
    if (!user || !user.username) {
      return false;
    }

    const [results]: [RowDataPacket[], FieldPacket[]] = await db.query<RowDataPacket[]>(
      "SELECT user_role FROM user WHERE user_name = ?",
      [user.username]
    );

    if (results.length === 0) {
      return false;
    }

    if (results[0].user_role !== "ADMIN") {
      return false;
    }

    return true;
  } catch (err: any) {
    return false;
  }
};

export default router;